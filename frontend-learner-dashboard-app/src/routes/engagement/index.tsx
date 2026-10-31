import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CalendarCheck,
  ChatCircleText,
  ClockCounterClockwise,
  Fire,
  Hourglass,
  Star,
  type Icon,
} from "@phosphor-icons/react";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { formatNumber } from "@/lib/formatters";
import { usePointsSummary } from "@/services/points";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import {
  EngagementTaskHostProvider,
  useEngagementTaskHost,
} from "@/routes/dashboard/-components/engagement/EngagementTaskHost";
import {
  useEngagementFeed,
  type UseEngagementFeedResult,
} from "@/routes/dashboard/-components/engagement/use-engagement-feed";
import { ecn, skinClasses } from "@/routes/dashboard/-components/engagement/engagement-tone";
import { StatTiles, TileProgress, WeekDots, type StatTileData } from "./-components/StatTiles";
import { TodayTab } from "./-components/TodayTab";
import { AnswersTab } from "./-components/AnswersTab";
import { PastTab } from "./-components/PastTab";

/**
 * `/engagement`: the learner's daily tasks in one place (learner plan §3.6).
 *
 * - Tabs Today · Answers · Past, kept in the URL (`?tab=`), so a reveal push can
 *   land on `?tab=answers` and `/engagement/history` redirects to `?tab=past`.
 * - `?slot=<slotId>` (a task push, D49) opens that slot's task in the runner once
 *   the feed is known, then leaves the URL so Back and refresh do not reopen it.
 * - Header tiles: Today, the server streak and this week's points. Streak and
 *   points are hidden when the institute turns gamification off.
 * - The page mounts its own `EngagementTaskHostProvider`: the one runner sheet.
 */

const TABS = ["today", "answers", "past"] as const;
export type EngagementTab = (typeof TABS)[number];

export interface EngagementSearch {
  tab?: EngagementTab;
  slot?: string;
}

/** Slot ids are UUIDs; anything else in `?slot=` is ignored rather than sent on. */
const SLOT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const Route = createFileRoute("/engagement/")({
  validateSearch: (search: Record<string, unknown>): EngagementSearch => {
    const tab =
      typeof search.tab === "string" && (TABS as readonly string[]).includes(search.tab)
        ? (search.tab as EngagementTab)
        : undefined;
    const slot =
      typeof search.slot === "string" && SLOT_ID.test(search.slot.trim()) ? search.slot.trim() : undefined;
    return { tab, slot };
  },
  component: EngagementRoute,
});

function EngagementRoute() {
  const showGamification = useShowGamification();
  return (
    <LayoutContainer>
      <EngagementTaskHostProvider showGamification={showGamification}>
        <EngagementPage />
      </EngagementTaskHostProvider>
    </LayoutContainer>
  );
}

/**
 * Whether the institute shows points and streaks (the dashboard's `gamification`
 * widget). Read from the cached display settings; shown until they say otherwise,
 * as on the dashboard.
 */
function useShowGamification(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let active = true;
    getStudentDisplaySettings(false)
      .then((settings) => {
        const widget = settings?.dashboard?.widgets?.find((w) => w.id === "gamification");
        if (active) setVisible(widget ? widget.visible !== false : true);
      })
      .catch(() => {
        // Settings unavailable: keep the default.
      });
    return () => {
      active = false;
    };
  }, []);
  return visible;
}

/**
 * `?slot=`: open the runner on that slot once the feed has loaded (the host
 * resolves the slot against it), then drop the param. One open per slot value.
 */
function useSlotDeepLink(slot: string | undefined, feed: UseEngagementFeedResult) {
  const host = useEngagementTaskHost();
  const navigate = Route.useNavigate();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!slot || feed.status === "loading" || handled.current === slot) return;
    handled.current = slot;
    host.openSlot(slot);
    void navigate({
      search: (prev: EngagementSearch) => ({ ...prev, slot: undefined }),
      replace: true,
    });
  }, [slot, feed.status, host, navigate]);
}

function TabLabel({
  icon: TabIcon,
  label,
  count,
  countLabel,
}: {
  icon: Icon;
  label: string;
  count?: number;
  /** Screen-reader text for the count, e.g. "3 open". */
  countLabel?: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {/* The icon gives way on phones so the three labels never truncate. */}
      <TabIcon aria-hidden weight="duotone" className="hidden size-4 shrink-0 sm:block" />
      <span className="truncate">{label}</span>
      {count != null && count > 0 && (
        <span
          aria-hidden
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary-500 px-1.5 text-caption font-semibold tabular-nums text-primary-foreground [.ui-play_&]:bg-play-accent [.ui-play_&]:text-white [.ui-cleaner-play_&]:bg-cp-terracotta [.ui-cleaner-play_&]:text-cp-surface"
        >
          {formatNumber(count)}
        </span>
      )}
      {count != null && count > 0 && countLabel && <span className="sr-only">{countLabel}</span>}
    </span>
  );
}

function EngagementPage() {
  const { t } = useTranslation("dashboardEngagement");
  const { setNavHeading } = useNavHeadingStore();
  const { tab: tabParam, slot } = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: EngagementTab = tabParam ?? "today";

  const showGamification = useShowGamification();
  const feed = useEngagementFeed();
  const points = usePointsSummary({ enabled: showGamification });

  useEffect(() => {
    setNavHeading(t("page.title"));
  }, [setNavHeading, t]);

  useSlotDeepLink(slot, feed);

  const onTabChange = (value: string) => {
    if (!(TABS as readonly string[]).includes(value)) return;
    void navigate({
      search: (prev: EngagementSearch) => ({ ...prev, tab: value === "today" ? undefined : (value as EngagementTab) }),
      replace: true,
    });
  };

  // --- Header tiles -----------------------------------------------------------------
  const data = feed.feed;
  const openToday = data
    ? data.items.filter((i) => (i.attemptStatus ?? "").toUpperCase() !== "COMPLETED" && i.state !== "UPCOMING").length
    : 0;
  const catchUpCount = data
    ? data.catchUp.filter((i) => (i.attemptStatus ?? "").toUpperCase() !== "COMPLETED").length
    : 0;
  const newAnswers = data?.revealed.length ?? 0;

  const todayTile: StatTileData = {
    id: "today",
    label: t("page.stats.today"),
    icon: CalendarCheck,
    tone: "info",
    loading: feed.status === "loading",
    value:
      feed.status === "error"
        ? t("page.stats.unavailable")
        : data && data.scheduledToday > 0
          ? t("page.stats.todayValue", { done: Math.min(data.completedToday, data.scheduledToday), count: data.scheduledToday })
          : t("page.stats.todayNone"),
    caption:
      feed.status === "error"
        ? null
        : data && data.scheduledToday > 0
          ? openToday > 0
            ? t("page.stats.todayLeft", { count: openToday })
            : data.completedToday >= data.scheduledToday
              ? t("page.stats.todayAllDone")
              : null
          : null,
    footer:
      data && data.scheduledToday > 0 ? (
        <TileProgress
          done={data.completedToday}
          total={data.scheduledToday}
          label={t("page.stats.todayProgress", { done: data.completedToday, count: data.scheduledToday })}
        />
      ) : null,
  };

  const summary = points.data;
  const streak = typeof summary?.currentStreak === "number" ? summary.currentStreak : null;
  const streakTile: StatTileData = {
    id: "streak",
    label: t("page.stats.streak"),
    icon: Fire,
    tone: "warn",
    loading: points.isPending,
    value: streak == null ? t("page.stats.unavailable") : t("page.stats.streakValue", { count: streak }),
    caption:
      streak == null
        ? null
        : summary?.keptToday
          ? t("page.stats.streakKept")
          : streak > 0
            ? t("page.stats.streakAtRisk")
            : t("page.stats.streakZero"),
    footer: <WeekDots days={summary?.last7Days} />,
  };

  const weekTile: StatTileData = {
    id: "week",
    label: t("page.stats.week"),
    icon: Star,
    tone: "accent",
    loading: points.isPending,
    value: summary ? (
      <>
        <span className="[.ui-play_&]:hidden [.ui-cleaner-play_&]:hidden">
          {t("page.stats.weekPts", { count: summary.weekPoints, value: formatNumber(summary.weekPoints) })}
        </span>
        <span className="hidden [.ui-play_&]:inline [.ui-cleaner-play_&]:inline">
          {t("page.stats.weekXp", { count: summary.weekPoints, value: formatNumber(summary.weekPoints) })}
        </span>
      </>
    ) : (
      t("page.stats.unavailable")
    ),
    caption:
      summary && summary.todayPoints > 0
        ? t("page.stats.weekToday", { count: summary.todayPoints, value: formatNumber(summary.todayPoints) })
        : null,
  };

  const catchUpTile: StatTileData = {
    id: "catchUp",
    label: t("page.stats.catchUp"),
    icon: Hourglass,
    tone: "warn",
    loading: feed.status === "loading",
    value: feed.status === "error" ? t("page.stats.unavailable") : formatNumber(catchUpCount),
  };

  const tiles = showGamification ? [todayTile, streakTile, weekTile] : [todayTile, catchUpTile];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-section">
      <header className="flex flex-col gap-1">
        <h1 className={ecn("text-h2 font-semibold", skinClasses("ink"))}>{t("page.title")}</h1>
        <p className={ecn("text-body", skinClasses("mutedInk"))}>{t("page.subtitle")}</p>
      </header>

      <StatTiles tiles={tiles} label={t("page.stats.label")} />

      <Tabs value={tab} onValueChange={onTabChange} className="flex flex-col gap-stack">
        <TabsList
          aria-label={t("page.tabs.label")}
          className={ecn(
            "grid h-auto min-h-11 w-full grid-cols-3 gap-1 p-1 sm:inline-grid sm:w-auto sm:self-start",
            "[.ui-play_&]:rounded-play-btn [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep"
          )}
        >
          <TabsTrigger value="today" className="min-h-11 px-2 sm:px-4">
            <TabLabel
              icon={CalendarCheck}
              label={t("page.tabs.today")}
              count={openToday + catchUpCount}
              countLabel={t("page.tabs.openCount", { count: openToday + catchUpCount })}
            />
          </TabsTrigger>
          <TabsTrigger value="answers" className="min-h-11 px-2 sm:px-4">
            <TabLabel
              icon={ChatCircleText}
              label={t("page.tabs.answers")}
              count={newAnswers}
              countLabel={t("page.tabs.newCount", { count: newAnswers })}
            />
          </TabsTrigger>
          <TabsTrigger value="past" className="min-h-11 px-2 sm:px-4">
            <TabLabel icon={ClockCounterClockwise} label={t("page.tabs.past")} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-0 focus-visible:ring-offset-0">
          <TodayTab feed={feed} showPoints={showGamification} />
        </TabsContent>
        <TabsContent value="answers" className="mt-0 focus-visible:ring-offset-0">
          <AnswersTab feed={feed} showPoints={showGamification} />
        </TabsContent>
        <TabsContent value="past" className="mt-0 focus-visible:ring-offset-0">
          <PastTab showPoints={showGamification} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
