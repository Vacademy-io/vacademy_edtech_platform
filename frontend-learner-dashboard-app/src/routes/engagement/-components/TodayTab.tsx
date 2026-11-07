import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarBlank, CaretDown, CaretRight, CheckCircle, LockSimple } from "@phosphor-icons/react";
import type { EngagementFeed, EngagementItem } from "@/services/engagement";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState, ErrorState, LoadingState } from "@/components/design-system/states";
import type { UseEngagementFeedResult } from "@/routes/dashboard/-components/engagement/use-engagement-feed";
import { useEngagementTaskHost } from "@/routes/dashboard/-components/engagement/EngagementTaskHost";
import { TimeLeft } from "@/routes/dashboard/-components/engagement/TimeLeft";
import { PointsChip, StateBadge, type EngagementBadgeKind } from "@/routes/dashboard/-components/engagement/EngagementBadge";
import { visualFor } from "@/routes/dashboard/-components/engagement/engagement-visuals";
import { glimpseFor, promptTextFor } from "@/routes/dashboard/-components/engagement/engagement-preview";
import { ecn, skinClasses, toneClasses } from "@/routes/dashboard/-components/engagement/engagement-tone";
import {
  answerFormat,
  catchUpLine,
  durationLabel,
  formatClock,
  pointsBreakdown,
  pointsLine,
  sharedDeadline,
  showsOwnDeadline,
  typeLabel,
} from "@/routes/dashboard/-components/engagement/engagement-copy";
import { isoDayShort } from "./DayStrip";
import { EarnedPoints } from "./PastRow";
import { TutorBuddyLine } from "@/components/chatbot/moments/TutorBuddyLine";

/**
 * The Today tab (§3.6): today's tasks as rich grouped rows. Every row opens the
 * runner through the task host; nothing is answered inline on this page.
 *
 * Groups: Must do · Bonus · From yesterday · Done today · Coming up. The deadline
 * every open task shares is said once, above the groups (D53); a row repeats it
 * only when its own differs or is under two hours away.
 */

function isDone(item: EngagementItem): boolean {
  return (item.attemptStatus ?? "").toUpperCase() === "COMPLETED";
}

function uniqueById(items: EngagementItem[]): EngagementItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

interface TodayView {
  mustDo: EngagementItem[];
  bonus: EngagementItem[];
  catchUp: EngagementItem[];
  done: EngagementItem[];
  upcoming: EngagementItem[];
  /** Open ids in the order the runner should walk them. */
  queue: string[];
  donePoints: number;
  multiBatch: boolean;
  shared: string | null;
}

function buildView(feed: EngagementFeed): TodayView {
  const open = feed.items.filter((i) => !isDone(i) && (i.state ?? "OPEN") !== "UPCOMING");
  const mustDo = open.filter((i) => i.isRequired);
  const bonus = open.filter((i) => !i.isRequired);
  const catchUp = feed.catchUp.filter((i) => !isDone(i));
  const done = uniqueById([...feed.doneToday, ...feed.items.filter(isDone), ...feed.catchUp.filter(isDone)]);
  const upcoming = [...feed.upcoming, ...feed.items.filter((i) => i.state === "UPCOMING")];
  const batches = new Set(
    [...feed.items, ...feed.catchUp, ...feed.doneToday, ...feed.upcoming].map((i) => i.packageSessionId).filter(Boolean)
  );
  return {
    mustDo,
    bonus,
    catchUp,
    done,
    upcoming: uniqueById(upcoming),
    queue: [...mustDo, ...bonus, ...catchUp].map((i) => i.id),
    donePoints: done.reduce((sum, i) => sum + (i.pointsAwarded ?? 0), 0),
    multiBatch: batches.size > 1,
    shared: sharedDeadline(feed.items),
  };
}

// --- Row ------------------------------------------------------------------------------

type RowKind = "open" | "catchUp" | "done" | "upcoming";

interface TodayRowProps {
  item: EngagementItem;
  kind: RowKind;
  showPoints: boolean;
  showBatch: boolean;
  shared: string | null;
  now: number;
  onOpen?: () => void;
}

function doneBadgeKind(item: EngagementItem): EngagementBadgeKind {
  if (item.resultPending === true) return "pending";
  if (answerFormat(item) === "MCQ" && item.isCorrect === true) return "correct";
  if (answerFormat(item) === "MCQ" && item.isCorrect === false) return "wrong";
  return item.isLate ? "late" : "done";
}

function TodayRow({ item, kind, showPoints, showBatch, shared, now, onOpen }: TodayRowProps) {
  const { t } = useTranslation("dashboardEngagement");
  const visual = visualFor(item);
  const TypeIcon = visual.icon;
  const upcoming = kind === "upcoming";

  const glimpse =
    item.itemType === "POLL" || answerFormat(item) === "MCQ" ? promptTextFor(item) : glimpseFor(item, t);
  const duration = item.itemType === "FLASHCARDS" ? null : durationLabel(item, t);
  const meta = [typeLabel(item, t), duration].filter(Boolean).join(" · ");

  // Points: the skin's chip for a plain amount; a sentence only when there is more
  // to say (a bonus, "up to", the answer already out), as on the home module.
  let status: string | null = null;
  let pointsNode: ReactNode = null;
  if (kind === "open" && showPoints) {
    const breakdown = pointsBreakdown(item);
    if (breakdown.bonus > 0 || breakdown.upTo || breakdown.answerOut) status = pointsLine(item, t, now) || null;
    else pointsNode = <PointsChip item={item} />;
  }
  if (kind === "catchUp") status = catchUpLine(item, t, now);
  if (kind === "done") {
    if (item.itemType === "FLASHCARDS" && item.flashcardsResult) {
      status = t("page.past.knewOf", { known: item.flashcardsResult.known, total: item.flashcardsResult.total });
    }
    if (showPoints) pointsNode = <EarnedPoints item={item} />;
  }
  const ownDeadline = kind === "open" && showsOwnDeadline(item, shared, now);

  const body = (
    <>
      <span aria-hidden className="shrink-0">
        <span
          className={ecn(
            "flex size-10 items-center justify-center rounded-lg [.ui-cleaner-play_&]:hidden",
            toneClasses(visual.tone, "tile"),
            upcoming && "opacity-60"
          )}
        >
          {upcoming ? <LockSimple weight="bold" className="size-5" /> : <TypeIcon weight="duotone" className="size-5" />}
        </span>
        <img
          src={visual.art}
          alt=""
          className={ecn("hidden size-10 object-contain [.ui-cleaner-play_&]:block", upcoming && "opacity-60")}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={ecn("text-caption", skinClasses("mutedInk"))}>{meta}</span>
          {showBatch && item.packageSessionName && (
            <span dir="auto" className={ecn("min-w-0 truncate text-caption", skinClasses("mutedInk"))}>
              {item.packageSessionName}
            </span>
          )}
        </span>
        <span
          dir="auto"
          className={ecn(
            "line-clamp-2 break-words text-body font-semibold",
            upcoming ? skinClasses("mutedInk") : skinClasses("ink")
          )}
        >
          {item.title}
        </span>
        {glimpse && !upcoming && kind !== "done" && (
          <span dir="auto" className={ecn("line-clamp-2 break-words text-caption", skinClasses("mutedInk"))}>
            {glimpse}
          </span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {kind === "done" && <StateBadge kind={doneBadgeKind(item)} now={now} />}
          {upcoming && <StateBadge kind="upcoming" at={item.opensAt} now={now} />}
          {kind === "catchUp" && showPoints && <PointsChip item={item} struck />}
          {pointsNode}
          {status && (
            <span className={ecn("text-caption tabular-nums", skinClasses("mutedInk"))}>{status}</span>
          )}
          {ownDeadline && <TimeLeft closesAt={item.closesAt} whenPassed="hide" />}
        </span>
      </span>
      {onOpen && (
        <CaretRight
          aria-hidden
          weight="bold"
          className={ecn(
            "mt-3 size-4 shrink-0 transition-transform duration-150 rtl:-scale-x-100 motion-safe:group-hover:translate-x-0.5 motion-safe:rtl:group-hover:-translate-x-0.5",
            skinClasses("mutedInk")
          )}
        />
      )}
    </>
  );

  if (onOpen) {
    return (
      <li>
        <button
          type="button"
          onClick={onOpen}
          className={ecn(
            "group flex w-full min-w-0 items-start gap-3 px-3 py-3 text-start transition-colors duration-150 sm:px-card",
            "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400",
            "[.ui-play_&]:hover:bg-play-info-soft [.ui-cleaner-play_&]:hover:bg-cp-bg-deep"
          )}
        >
          {body}
        </button>
      </li>
    );
  }
  return <li className="flex min-w-0 items-start gap-3 px-3 py-3 sm:px-card">{body}</li>;
}

/** "pts" in the standard skins, "XP" in play and cleanerPlay (§3.8). */
function PointsWords({ pts, xp }: { pts: string; xp: string }) {
  return (
    <>
      <span className="[.ui-play_&]:hidden [.ui-cleaner-play_&]:hidden">{pts}</span>
      <span className="hidden [.ui-play_&]:inline [.ui-cleaner-play_&]:inline">{xp}</span>
    </>
  );
}

// --- Group ---------------------------------------------------------------------------------

const LIST = "divide-y divide-border overflow-hidden [.ui-cleaner-play_&]:divide-cp-border";

function Group({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string | null;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id={id} className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
          {title}
        </h2>
        {hint && <p className={ecn("text-caption", skinClasses("mutedInk"))}>{hint}</p>}
      </div>
      <ul className={ecn(skinClasses("card"), LIST)}>{children}</ul>
    </section>
  );
}

// --- Tab ----------------------------------------------------------------------------------------

export interface TodayTabProps {
  feed: UseEngagementFeedResult;
  showPoints: boolean;
}

export function TodayTab({ feed, showPoints }: TodayTabProps) {
  const { t } = useTranslation("dashboardEngagement");
  const host = useEngagementTaskHost();
  const [doneOpen, setDoneOpen] = useState<boolean | null>(null);
  const now = feed.serverNow();
  const view = useMemo(() => (feed.feed ? buildView(feed.feed) : null), [feed.feed]);

  if (feed.status === "loading") return <LoadingState variant="list" count={4} />;
  if (feed.status === "error") {
    return (
      <div className={ecn(skinClasses("card"), "p-card")}>
        <ErrorState title={t("page.today.error")} onRetry={feed.retry} />
      </div>
    );
  }
  if (!feed.feed || !view) {
    return (
      <div className={ecn(skinClasses("card"), "p-card")}>
        <EmptyState
          icon={CalendarBlank}
          title={t("page.today.noPlanTitle")}
          description={t("page.today.noPlanBody")}
          compact
        />
      </div>
    );
  }

  const data = feed.feed;
  const openCount = view.mustDo.length + view.bonus.length;
  // Nothing open is not the same as all done: a task can still unlock later today, or
  // have closed unfinished.
  const allDone =
    data.scheduledToday > 0 &&
    data.completedToday >= data.scheduledToday &&
    openCount === 0 &&
    !data.capApplied;
  const nothingToday = data.scheduledToday === 0 && openCount === 0 && view.done.length === 0;
  const open = (item: EngagementItem, readOnly = false) =>
    host.open(item.id, { queue: readOnly ? [item.id] : view.queue, readOnly, item });
  const rowProps = { showPoints, showBatch: view.multiBatch, shared: view.shared, now };
  // Done is folded while there is still work to do, open once the day is finished.
  const doneExpanded = doneOpen ?? (openCount === 0 && view.catchUp.length === 0);

  const nextDay = view.upcoming
    .map((i) => i.runDate)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const nextCount = nextDay ? view.upcoming.filter((i) => i.runDate === nextDay).length : 0;
  const hiddenByCap = data.hiddenByCap ?? 0;

  return (
    <div className="flex flex-col gap-section">
      <TutorBuddyLine />

      {feed.refetchError && (
        <ErrorState variant="inline" message={t("page.refreshError")} onRetry={feed.retry} />
      )}

      {allDone && (
        <div
          role="status"
          className={ecn(
            skinClasses("card"),
            "flex items-center gap-3 p-3 sm:p-card",
            "border-success-200 bg-success-50 [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-success-soft [.ui-cleaner-play_&]:bg-cp-sage-tint"
          )}
        >
          <CheckCircle
            aria-hidden
            weight="fill"
            className="size-8 shrink-0 text-success-700 motion-safe:animate-in motion-safe:zoom-in-90 [.ui-play_&]:text-play-success-soft-ink [.ui-cleaner-play_&]:text-cp-sage"
          />
          <div className="min-w-0">
            <p className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
              {t("page.today.allDone", { count: data.scheduledToday })}
            </p>
            <p className={ecn("text-caption", skinClasses("mutedInk"))}>
              {showPoints && view.donePoints > 0 ? (
                <PointsWords
                  pts={t("page.today.allDonePoints", { count: view.donePoints })}
                  xp={t("page.today.allDonePointsXp", { count: view.donePoints })}
                />
              ) : (
                t("page.today.allDoneBody")
              )}
            </p>
          </div>
        </div>
      )}

      {nothingToday && (
        <div className={ecn(skinClasses("card"), "p-card")}>
          <EmptyState
            icon={CalendarBlank}
            title={t("page.today.nothingTitle")}
            description={
              nextDay
                ? t("page.today.nothingNext", { date: isoDayShort(nextDay), count: nextCount })
                : t("page.today.nothingBody")
            }
            compact
          />
        </div>
      )}

      {view.shared && openCount > 0 && (
        <p className={ecn("flex flex-wrap items-center gap-x-2 gap-y-1 text-caption", skinClasses("mutedInk"))}>
          <span>{t("page.today.sharedDeadline", { time: formatClock(view.shared, now) })}</span>
          <TimeLeft closesAt={view.shared} whenPassed="hide" />
        </p>
      )}

      {view.mustDo.length > 0 && (
        <Group id="engagement-today-must" title={t("page.today.mustDo", { count: view.mustDo.length })}>
          {view.mustDo.map((item) => (
            <TodayRow key={item.id} item={item} kind="open" {...rowProps} onOpen={() => open(item)} />
          ))}
        </Group>
      )}

      {view.bonus.length > 0 && (
        <Group id="engagement-today-bonus" title={t("page.today.bonus", { count: view.bonus.length })}>
          {view.bonus.map((item) => (
            <TodayRow key={item.id} item={item} kind="open" {...rowProps} onOpen={() => open(item)} />
          ))}
        </Group>
      )}

      {(hiddenByCap > 0 || (data.capApplied && openCount > 0)) && (
        <p className={ecn("text-caption", skinClasses("mutedInk"))}>
          {hiddenByCap > 0 ? t("page.today.moreUnlock", { count: hiddenByCap }) : t("page.today.moreUnlockPlain")}
        </p>
      )}

      {view.catchUp.length > 0 && (
        <Group
          id="engagement-today-catchup"
          title={t("page.today.fromYesterday", { count: view.catchUp.length })}
          hint={t("page.today.fromYesterdayHint")}
        >
          {view.catchUp.map((item) => (
            <TodayRow key={item.id} item={item} kind="catchUp" {...rowProps} onOpen={() => open(item)} />
          ))}
        </Group>
      )}

      {view.done.length > 0 && (
        <Collapsible open={doneExpanded} onOpenChange={setDoneOpen} className="flex flex-col gap-2">
          <CollapsibleTrigger
            className={ecn(
              "group flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-start",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
                {t("page.today.doneToday", { count: view.done.length })}
              </span>
              {showPoints && view.donePoints > 0 && (
                <span className={ecn("text-caption tabular-nums", skinClasses("mutedInk"))}>
                  <PointsWords
                    pts={t("page.today.donePoints", { count: view.donePoints })}
                    xp={t("page.today.donePointsXp", { count: view.donePoints })}
                  />
                </span>
              )}
            </span>
            <CaretDown
              aria-hidden
              weight="bold"
              className={ecn(
                "size-4 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180",
                skinClasses("mutedInk")
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className={ecn(skinClasses("card"), LIST)}>
              {view.done.map((item) => (
                <TodayRow key={item.id} item={item} kind="done" {...rowProps} onOpen={() => open(item, true)} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {view.upcoming.length > 0 && (
        <Group
          id="engagement-today-upcoming"
          title={t("page.today.comingUp", { count: view.upcoming.length })}
          hint={data.capApplied ? t("page.today.moreUnlockPlain") : null}
        >
          {view.upcoming.map((item) => (
            <TodayRow key={`${item.id}-${item.runDate}`} item={item} kind="upcoming" {...rowProps} />
          ))}
        </Group>
      )}
    </div>
  );
}
