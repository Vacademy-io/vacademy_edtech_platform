import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowClockwise,
  CalendarBlank,
  CalendarCheck,
  CaretDown,
  Coffee,
  WarningCircle,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { useCorporateTheme } from "@/hooks/use-corporate-theme";
import { usePointsSummary } from "@/services/points";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { EngagementFeed, EngagementItem } from "@/services/engagement";
import type { CelebrationSkin } from "@/lib/play-celebration";
import { ecn, skinClasses } from "./engagement-tone";
import {
  catchUpLine,
  effectivePoints,
  isCompleted,
  outcomeOf,
  sharedDeadline as sharedDeadlineOf,
  type EngagementOutcome,
} from "./engagement-copy";
import { findEngagementItem, useEngagementFeed } from "./use-engagement-feed";
import { usePinnedUpNext } from "./engagement-draft-store";
import { useEngagementTaskHost } from "./EngagementTaskHost";
import { PointsChip } from "./EngagementBadge";
import { TodayHeader } from "./TodayHeader";
import { AnswerRibbon } from "./AnswerRibbon";
import { UpNextRow, useUpNextOutcomeStore } from "./UpNextRow";
import { BatchLegend, TaskRow, type TaskBatch } from "./TaskRow";
import { TodayComplete } from "./TodayComplete";
import { ComingUpLine, dayLabel, groupComingUp } from "./ComingUpLine";
import { TutorBuddyLine } from "@/components/chatbot/moments/TutorBuddyLine";

/**
 * "Today": the learner's daily tasks as one compact dashboard module (learner
 * plan §3.3 / §3.4; D3, D5, D6, D7, D10, D17–D19, D21, D35, D36, D43, D50, D53).
 *
 * - `slot="rail"` (desktop right rail, ≤ 360 px collapsed): no inline options;
 *   Up next shows the prompt and opens the runner. One compact row.
 * - `slot="main"` (under the hero, and mobile): the multiple-choice Up next is
 *   answered in place. Two compact rows.
 * - Everything else sits in one disclosure: "7 more · 1 from yesterday · 8 done".
 * - Renders null when no plan is running. Tasks open in the runner through
 *   `useEngagementTaskHost()`, so `EngagementTaskHostProvider` must be mounted
 *   above this module.
 */

/** Literal dot classes for batches (Tailwind needs full class names). */
const BATCH_DOTS = [
  "bg-primary-500",
  "bg-info-500",
  "bg-warning-500",
  "bg-success-500",
  "bg-danger-500",
] as const;

// --- View model (pure) ----------------------------------------------------------------------

export interface TodayView {
  /** Plan-local date of today's run (yyyy-MM-dd), when the feed shows one. */
  todayKey: string | null;
  scheduled: number;
  completed: number;
  upNext: EngagementItem | null;
  upNextPinned: boolean;
  /** Compact rows under Up next. */
  rows: EngagementItem[];
  /** The rest of today's open tasks (inside the disclosure). */
  moreOpen: EngagementItem[];
  /** Earlier runs still inside their catch-up window. */
  catchUp: EngagementItem[];
  /** Finished today, newest first (the pinned task excluded while pinned). */
  done: EngagementItem[];
  /** Open task ids in display order, for the runner's "Next". */
  queue: string[];
  /** Another open today task follows the pinned one. */
  hasNextAfterPinned: boolean;
  allDone: boolean;
  /** No task runs today at all. */
  nothingToday: boolean;
  /** Tasks remain today, but none is open right now (later today, or capped). */
  waiting: boolean;
  requiredDone: number;
  requiredOpen: number;
  requiredTotal: number;
  pointsEarned: number;
  /** Earned plus everything still open (today and catch-up) at its current rate. */
  pointsReachable: number;
  /** Only when tasks come from 2+ batches (D35). */
  batches: Map<string, TaskBatch> | null;
}

function maxRunDate(rows: EngagementItem[]): string | null {
  let best: string | null = null;
  for (const row of rows) {
    if (row.runDate && (best == null || row.runDate > best)) best = row.runDate;
  }
  return best;
}

/** Everything the module draws, derived from the feed. Pure. */
export function buildTodayView(
  feed: EngagementFeed,
  pinnedId: string | null,
  compactCount: number
): TodayView {
  const pinnedItem = pinnedId ? findEngagementItem(feed, pinnedId) ?? null : null;
  const openToday = feed.items.filter((i) => !isCompleted(i) && i.id !== pinnedItem?.id);
  const catchUp = feed.catchUp.filter((i) => !isCompleted(i) && i.id !== pinnedItem?.id);
  const done = feed.doneToday.filter((i) => i.id !== pinnedItem?.id);

  const todayKey = maxRunDate(feed.items) ?? maxRunDate(feed.doneToday);
  const isTodayRun = (i: EngagementItem) => !todayKey || !i.runDate || i.runDate === todayKey;

  // Up next: the pinned (just answered) task, else the first open must-do, else server order.
  const firstRequired = openToday.find((i) => i.isRequired);
  const upNext = pinnedItem ?? firstRequired ?? openToday[0] ?? null;
  const rest = openToday.filter((i) => i.id !== upNext?.id);
  const rows = rest.slice(0, compactCount);
  const moreOpen = rest.slice(compactCount);

  const scheduled = Math.max(0, feed.scheduledToday);
  const completed = Math.max(0, feed.completedToday);

  const todayDone = feed.doneToday.filter(isTodayRun);
  const requiredDone = todayDone.filter((i) => i.isRequired).length;
  const requiredOpen = feed.items.filter((i) => i.isRequired && !isCompleted(i)).length;

  const pointsEarned = feed.doneToday.reduce((sum, i) => sum + Math.max(0, i.pointsAwarded ?? 0), 0);
  const pointsReachable =
    pointsEarned + [...openToday, ...catchUp].reduce((sum, i) => sum + effectivePoints(i), 0);

  const nothingToday = scheduled === 0 && feed.items.length === 0 && !pinnedItem;
  const allDone = !nothingToday && !upNext && completed >= scheduled;
  const waiting = !nothingToday && !upNext && !allDone;

  const batchNames = new Map<string, string>();
  for (const row of [...feed.items, ...feed.catchUp, ...feed.doneToday]) {
    if (row.packageSessionId && !batchNames.has(row.packageSessionId)) {
      batchNames.set(row.packageSessionId, row.packageSessionName || "");
    }
  }
  let batches: Map<string, TaskBatch> | null = null;
  if (batchNames.size > 1) {
    batches = new Map();
    [...batchNames.keys()].sort().forEach((id, index) => {
      batches!.set(id, {
        name: batchNames.get(id) ?? "",
        dotClass: BATCH_DOTS[index % BATCH_DOTS.length]!,
      });
    });
  }

  const queue = [
    ...(upNext && !pinnedItem ? [upNext.id] : []),
    ...rows.map((i) => i.id),
    ...moreOpen.map((i) => i.id),
    ...catchUp.map((i) => i.id),
  ];

  return {
    todayKey,
    scheduled,
    completed,
    upNext,
    upNextPinned: pinnedItem != null,
    rows,
    moreOpen,
    catchUp,
    done,
    queue,
    hasNextAfterPinned: pinnedItem != null && openToday.length > 0,
    allDone,
    nothingToday,
    waiting,
    requiredDone,
    requiredOpen,
    requiredTotal: requiredDone + requiredOpen,
    pointsEarned,
    pointsReachable,
    batches,
  };
}

/** The disclosure label parts: "7 more · 1 from yesterday · 8 done". */
export function disclosureCounts(
  view: Pick<TodayView, "moreOpen" | "catchUp" | "done">,
  catchUpInside: boolean
): { more: number; fromYesterday: number; done: number } {
  return {
    more: view.moreOpen.length,
    fromYesterday: catchUpInside ? view.catchUp.length : 0,
    done: view.done.length,
  };
}

// --- Hooks ---------------------------------------------------------------------------------------

function useCelebrationSkin(): { skin: CelebrationSkin; corporate: boolean } {
  const isPlay = usePlayTheme();
  const isCleanerPlay = useCleanerPlayTheme();
  const corporate = useCorporateTheme();
  return { skin: isPlay ? "play" : isCleanerPlay ? "cleanerPlay" : "other", corporate };
}

/** Server "now", refreshed each minute so relative copy ("closes in 6h") stays honest. */
function useMinuteNow(serverNow: () => number): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return serverNow();
}

// --- Small pieces ----------------------------------------------------------------------------------

function GroupLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 pb-0.5 pt-2">
      <p className={ecn("min-w-0 flex-1 text-caption font-semibold", skinClasses("mutedInk"))}>{children}</p>
      {trailing}
    </div>
  );
}

function ModuleShell({
  headingId,
  children,
  className,
}: {
  headingId?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={ecn("flex min-w-0 flex-col gap-2 p-card", skinClasses("card"), className)}
    >
      {children}
    </section>
  );
}

function TodaySkeleton({ slot }: { slot: "main" | "rail" }) {
  const { t } = useTranslation("dashboardEngagement");
  return (
    <ModuleShell>
      <span className="sr-only" role="status">
        {t("today.loading")}
      </span>
      <div aria-hidden className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="ms-auto h-5 w-12" />
        </div>
        <Skeleton className="h-1 w-full rounded-full" />
        <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
          {slot === "main" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : (
            <Skeleton className="h-11 w-full" />
          )}
        </div>
        {Array.from({ length: slot === "main" ? 2 : 0 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        ))}
      </div>
    </ModuleShell>
  );
}

function TodayError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { t } = useTranslation("dashboardEngagement");
  const headingId = useId();
  return (
    <ModuleShell headingId={headingId}>
      <div className="flex min-w-0 items-center gap-2">
        <CalendarCheck
          aria-hidden
          weight="duotone"
          className="size-5 shrink-0 text-primary-500 [.ui-cleaner-play_&]:text-cp-terracotta [.ui-corporate_&]:text-muted-foreground [.ui-play_&]:text-play-info-deep"
        />
        <h2 id={headingId} className={ecn("text-title font-semibold", skinClasses("ink"))}>
          {t("today.title")}
        </h2>
      </div>
      <div role="alert" className="flex min-w-0 flex-col items-start gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <WarningCircle aria-hidden weight="duotone" className="size-5 shrink-0 text-danger-700" />
          <p className={ecn("text-body font-medium", skinClasses("ink"))}>{t("today.loadError")}</p>
        </div>
        <MyButton
          type="button"
          buttonType="secondary"
          scale="medium"
          className="min-h-11"
          disable={retrying}
          onClick={onRetry}
        >
          <ArrowClockwise aria-hidden className="size-4" />
          {t("today.retry")}
        </MyButton>
      </div>
    </ModuleShell>
  );
}

// --- Module ----------------------------------------------------------------------------------------

export interface TodayModuleProps {
  slot: "main" | "rail";
  /**
   * The dashboard's "gamification" widget flag. Off: no points, streak or
   * celebration anywhere in the module. Defaults to on.
   */
  showGamification?: boolean;
  /**
   * Called with whether a plan is running once the feed settles (true/false),
   * so the dashboard can remember the rail slot. Never called while loading
   * or after a failed first load.
   */
  onHasPlanChange?: (hasPlan: boolean) => void;
  className?: string;
}

export function TodayModule({
  slot,
  showGamification = true,
  onHasPlanChange,
  className,
}: TodayModuleProps) {
  const { t } = useTranslation("dashboardEngagement");
  const navigate = useNavigate();
  const host = useEngagementTaskHost();
  const { feed, status, refetchError, isFetching, retry, serverNow } = useEngagementFeed();
  const { pinnedId, release } = usePinnedUpNext();
  const outcomesById = useUpNextOutcomeStore((s) => s.byId);
  const summaryQuery = usePointsSummary({ enabled: showGamification });
  const { skin: celebrationSkin, corporate } = useCelebrationSkin();
  const now = useMinuteNow(serverNow);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [focusUpNext, setFocusUpNext] = useState(false);

  // The rail has no room for compact rows under Up next (≤ 360 px collapsed);
  // its disclosure lists every other task. Phones keep one so the collapsed
  // module stays within one screen with an inline question.
  const isSmUp = useMediaQuery("(min-width: 640px)");
  const compactCount = slot === "rail" ? 0 : isSmUp ? 2 : 1;
  const view = useMemo(
    () => (feed ? buildTodayView(feed, pinnedId, compactCount) : null),
    [feed, pinnedId, compactCount]
  );

  // Report plan presence once the feed settles.
  useEffect(() => {
    if (status !== "ready") return;
    onHasPlanChange?.(feed != null);
  }, [status, feed, onHasPlanChange]);

  // A pinned task that left the feed entirely (a new day) is let go.
  useEffect(() => {
    if (feed && pinnedId && !findEngagementItem(feed, pinnedId)) release();
  }, [feed, pinnedId, release]);

  // After "Next task" with nothing left, focus lands on the heading (D7).
  useEffect(() => {
    if (focusUpNext && view && !view.upNext) {
      headingRef.current?.focus();
      setFocusUpNext(false);
    }
  }, [focusUpNext, view]);

  const sessionOutcomes = useMemo(() => {
    const out: Record<string, EngagementOutcome> = {};
    for (const [id, entry] of Object.entries(outcomesById)) {
      if (entry.status === "done" && entry.response) out[id] = outcomeOf(entry.response);
    }
    return out;
  }, [outcomesById]);

  const openTask = useCallback(
    (item: EngagementItem) => {
      if (isCompleted(item)) host.open(item.id, { readOnly: true, item });
      else host.open(item.id, { queue: view?.queue ?? [item.id], item });
    },
    [host, view]
  );

  const goToPage = useCallback(
    (tab: "today" | "answers") => {
      void navigate({ to: "/engagement", search: { tab } });
    },
    [navigate]
  );

  const onNext = useCallback(() => {
    release();
    setFocusUpNext(true);
  }, [release]);

  if (status === "loading") return <TodaySkeleton slot={slot} />;
  if (status === "error") return <TodayError onRetry={retry} retrying={isFetching} />;
  if (!feed || !view) return null;

  const showPoints = showGamification;
  const iconWeight = corporate ? "regular" : "duotone";
  const summary = showGamification ? (summaryQuery.data ?? null) : null;
  const shared = sharedDeadlineOf(feed.items);
  const batchOf = (item: EngagementItem) => view.batches?.get(item.packageSessionId) ?? null;
  const capped = feed.capApplied && (feed.hiddenByCap ?? 1) > 0;
  const firstGroup = groupComingUp(feed.upcoming, 1)[0] ?? null;
  const nextGroup = firstGroup
    ? { label: dayLabel(firstGroup.runDate, view.todayKey, t), opensAt: firstGroup.opensAt, count: firstGroup.count }
    : null;

  // Catch-ups sit in the disclosure while today's tasks lead; once today is done
  // (or nothing runs today) they are the only thing left to do, so they show.
  const catchUpInside = !(view.allDone || view.nothingToday || view.waiting);
  const counts = disclosureCounts(view, catchUpInside);
  const hasDisclosure = counts.more + counts.fromYesterday + counts.done > 0;
  const disclosureLabel = [
    counts.more > 0 ? t("today.more", { count: counts.more }) : null,
    counts.fromYesterday > 0 ? t("today.fromYesterday", { count: counts.fromYesterday }) : null,
    counts.done > 0 ? t("today.doneCount", { count: counts.done }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The all-done summary is about today's run; finished catch-ups stay in "Done today".
  const todayRunsDone = view.todayKey
    ? feed.doneToday.filter((i) => !i.runDate || i.runDate === view.todayKey)
    : feed.doneToday;

  const headerPoints =
    showPoints && !view.allDone && !view.nothingToday
      ? { earned: view.pointsEarned, total: view.pointsReachable }
      : null;

  const catchUpGroup = view.catchUp.length > 0 && (
    <div>
      <GroupLabel>{catchUpLine(view.catchUp[0]!, t, now)}</GroupLabel>
      <ul className="flex flex-col">
        {view.catchUp.map((item) => (
          <TaskRow
            key={item.id}
            item={item}
            variant="catchUp"
            onOpen={openTask}
            showPoints={showPoints}
            now={now}
            batch={batchOf(item)}
            iconWeight={iconWeight}
          />
        ))}
      </ul>
    </div>
  );

  // The rail keeps "Coming up" inside the disclosure so the collapsed module
  // stays within its height budget; elsewhere it is the module's last line.
  const showComingUp = !view.nothingToday && !view.allDone;
  const comingUpInside = slot === "rail" && hasDisclosure;
  const comingUpLine = (
    <ComingUpLine
      upcoming={feed.upcoming}
      todayKey={view.todayKey}
      capped={capped && !view.waiting}
      showPoints={showPoints}
      compact={slot === "rail"}
      className={ecn("px-2", comingUpInside && "pt-2")}
    />
  );

  const openRequired = view.moreOpen.filter((i) => i.isRequired);
  const openBonus = view.moreOpen.filter((i) => !i.isRequired);
  const splitMoreOpen = openRequired.length > 0 && openBonus.length > 0;
  const renderOpenRows = (items: EngagementItem[]) => (
    <ul className="flex flex-col">
      {items.map((item) => (
        <TaskRow
          key={item.id}
          item={item}
          onOpen={openTask}
          showPoints={showPoints}
          sharedDeadline={shared}
          now={now}
          batch={batchOf(item)}
          iconWeight={iconWeight}
        />
      ))}
    </ul>
  );

  return (
    <ModuleShell headingId={headingId} className={className}>
      <TodayHeader
        headingId={headingId}
        headingRef={headingRef}
        scheduled={view.scheduled}
        completed={view.completed}
        requiredDone={view.requiredDone}
        requiredOpen={view.requiredOpen}
        points={headerPoints}
        summary={summary}
        sharedDeadline={shared}
        now={now}
        onOpenPage={() => goToPage("today")}
        inline={slot === "main"}
        compact={slot === "rail"}
        iconWeight={iconWeight}
      />

      {/* One timely line from the tutor; renders nothing when it has none. */}
      <TutorBuddyLine />

      {view.batches && (
        <BatchLegend batches={[...view.batches.values()]} label={t("today.batchesAria")} />
      )}

      {refetchError && (
        <p className={ecn("flex items-center gap-1.5 text-caption", skinClasses("mutedInk"))}>
          <WarningCircle aria-hidden className="size-3.5 shrink-0 text-warning-700" />
          {t("today.refreshError")}
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={retry}
            disabled={isFetching}
            className="rounded-sm font-medium text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-60"
          >
            {t("today.retry")}
          </button>
        </p>
      )}

      <AnswerRibbon
        revealed={feed.revealed}
        todayKey={view.todayKey}
        onSeeAnswers={() => goToPage("answers")}
        compact={slot === "rail"}
      />

      {view.upNext && (
        <UpNextRow
          key={view.upNext.id}
          item={view.upNext}
          slot={slot}
          pinned={view.upNextPinned}
          hasNext={view.hasNextAfterPinned}
          onOpen={openTask}
          onNext={onNext}
          showPoints={showPoints}
          sharedDeadline={shared}
          now={now}
          batch={batchOf(view.upNext)}
          iconWeight={iconWeight}
          celebrationSkin={celebrationSkin}
          autoFocusTitle={focusUpNext}
          onAutoFocused={() => setFocusUpNext(false)}
        />
      )}

      {view.rows.length > 0 && renderOpenRows(view.rows)}

      {view.allDone && (
        <TodayComplete
          total={view.scheduled}
          doneToday={todayRunsDone}
          pointsToday={view.pointsEarned}
          showPoints={showPoints}
          next={nextGroup}
          outcomes={sessionOutcomes}
          celebrationSkin={celebrationSkin}
          compact={slot === "rail"}
          now={now}
        />
      )}

      {view.nothingToday && (
        <p className={ecn("flex min-w-0 items-center gap-2 text-body", skinClasses("mutedInk"))}>
          <CalendarBlank aria-hidden weight={iconWeight} className="size-5 shrink-0" />
          <span className="min-w-0">
            <span className={ecn("font-medium", skinClasses("ink"))}>{t("today.nothingDue")}</span>
            {nextGroup && (
              <>
                {" · "}
                {t("today.nextOn", { day: nextGroup.label, count: nextGroup.count })}
              </>
            )}
          </span>
        </p>
      )}

      {view.waiting && (
        <p className={ecn("flex min-w-0 items-center gap-2 text-body", skinClasses("mutedInk"))}>
          <Coffee aria-hidden weight={iconWeight} className="size-5 shrink-0" />
          {capped ? t("today.capped") : t("today.nothingOpen")}
        </p>
      )}

      {!catchUpInside && catchUpGroup}

      {hasDisclosure && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger
            className={ecn(
              "flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-start font-medium",
              // One line: caption size where the column is narrow (rail, phone).
              slot === "rail" ? "min-h-9 text-caption" : "min-h-11 text-caption sm:min-h-10 sm:text-body",
              "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400",
              skinClasses("ink")
            )}
          >
            <span className={ecn("min-w-0 flex-1", slot === "rail" ? "line-clamp-2 py-1" : "truncate")}>
              {expanded ? t("today.showLess") : disclosureLabel}
            </span>
            <CaretDown
              aria-hidden
              weight="bold"
              className={ecn(
                "size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150",
                skinClasses("mutedInk"),
                expanded && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1">
            {view.moreOpen.length > 0 &&
              (splitMoreOpen ? (
                <>
                  <div>
                    <GroupLabel>
                      {t("today.groups.mustDo", { done: view.requiredDone, total: view.requiredTotal })}
                    </GroupLabel>
                    {renderOpenRows(openRequired)}
                  </div>
                  <div>
                    <GroupLabel>{t("today.groups.bonus")}</GroupLabel>
                    {renderOpenRows(openBonus)}
                  </div>
                </>
              ) : (
                renderOpenRows(view.moreOpen)
              ))}
            {catchUpInside && catchUpGroup}
            {view.done.length > 0 && (
              <div>
                <GroupLabel
                  trailing={
                    showPoints && view.pointsEarned > 0 ? (
                      <PointsChip value={view.pointsEarned} earned />
                    ) : undefined
                  }
                >
                  {t("today.groups.done", { count: view.done.length })}
                </GroupLabel>
                <ul className="flex flex-col">
                  {view.done.map((item) => (
                    <TaskRow
                      key={item.id}
                      item={item}
                      variant="done"
                      onOpen={openTask}
                      showPoints={showPoints}
                      now={now}
                      batch={batchOf(item)}
                      iconWeight={iconWeight}
                      outcome={sessionOutcomes[item.id]}
                    />
                  ))}
                </ul>
              </div>
            )}
            {showComingUp && comingUpInside && comingUpLine}
          </CollapsibleContent>
        </Collapsible>
      )}

      {showComingUp && !comingUpInside && comingUpLine}
    </ModuleShell>
  );
}
