import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle, ClockCounterClockwise, Hourglass, MinusCircle, Star } from "@phosphor-icons/react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { formatNumber } from "@/lib/formatters";
import type { EngagementHistory, EngagementItem } from "@/services/engagement";
import { useCurrentInstituteId } from "@/services/points";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, ErrorState, LoadingState } from "@/components/design-system/states";
import {
  ENGAGEMENT_HISTORY_KEY,
  useServerClockSkew,
} from "@/routes/dashboard/-components/engagement/use-engagement-feed";
import { useEngagementTaskHost } from "@/routes/dashboard/-components/engagement/EngagementTaskHost";
import { ecn, skinClasses } from "@/routes/dashboard/-components/engagement/engagement-tone";
import { DayStrip, isoDayHeading, zonedIsoToday, type DayTally } from "./DayStrip";
import { PastRow } from "./PastRow";
import { StatTiles, type StatTileData } from "./StatTiles";

/**
 * The Past tab (D6, D21, D37, D40).
 *
 * - "Still catchable (n)" is pinned first: the only rows the learner can act on.
 * - Tiles: Done · Missed (closed only) · Can still catch up · Points.
 * - A strip of the last days, then the days themselves, newest first.
 * - Past starts yesterday: today's finished tasks live on the Today tab. A task that
 *   already closed today unfinished is kept, under "Today", so it is never lost.
 * - Days come from the server's plan-local `today`, never the device's UTC day.
 * - The previous window stays on screen while another loads, and after a catch-up
 *   the list refetches in place (the submit hook invalidates the history key).
 */

// --- Data -----------------------------------------------------------------------------

/** History plus the plan-local day the server computed it for. */
export interface EngagementHistoryPage extends EngagementHistory {
  /** Plan-local today (`yyyy-MM-dd`). */
  today: string;
  /** The plan's IANA zone, when the server sends it. */
  timezone: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_URL = `${BASE_URL}/admin-core-service/engagement/learner/v1/history`;

/**
 * GET history, keeping `today` and `timezone`. The shared `fetchEngagementHistory`
 * drops those two fields, and this page needs them to place days correctly.
 */
async function fetchHistoryPage(instituteId: string, days: number): Promise<EngagementHistoryPage> {
  const { data } = await authenticatedAxiosInstance.get(HISTORY_URL, { params: { instituteId, days } });
  const timezone = typeof data?.timezone === "string" && data.timezone ? data.timezone : null;
  const today =
    typeof data?.today === "string" && ISO_DAY.test(data.today)
      ? data.today
      : typeof data?.to === "string" && ISO_DAY.test(data.to)
        ? data.to
        : zonedIsoToday(timezone);
  return {
    from: String(data?.from ?? ""),
    to: String(data?.to ?? today),
    items: Array.isArray(data?.items) ? (data.items as EngagementItem[]) : [],
    done: Number(data?.done ?? 0),
    missed: Number(data?.missed ?? 0),
    catchUp: Number(data?.catchUp ?? 0),
    pointsEarned: Number(data?.pointsEarned ?? 0),
    today,
    timezone,
  };
}

export interface UseEngagementHistoryResult {
  data: EngagementHistoryPage | undefined;
  status: "loading" | "ready" | "error";
  /** A refresh failed while older data is still shown. */
  refetchError: boolean;
  /** Showing the previous window while this one loads. */
  isPlaceholder: boolean;
  isFetching: boolean;
  retry: () => void;
}

/**
 * The learner's past tasks over `days` days, cached under the history key so a
 * submit anywhere refreshes it. No institute: an empty, ready result.
 */
export function useEngagementHistory(days: number, opts: { enabled?: boolean } = {}): UseEngagementHistoryResult {
  const instituteId = useCurrentInstituteId();
  const query = useQuery({
    queryKey: [...ENGAGEMENT_HISTORY_KEY, instituteId ?? null, days],
    queryFn: () => fetchHistoryPage(instituteId as string, days),
    enabled: (opts.enabled ?? true) && Boolean(instituteId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (instituteId === null) {
    const today = zonedIsoToday();
    return {
      data: { from: today, to: today, items: [], done: 0, missed: 0, catchUp: 0, pointsEarned: 0, today, timezone: null },
      status: "ready",
      refetchError: false,
      isPlaceholder: false,
      isFetching: false,
      retry,
    };
  }
  const hasData = query.data !== undefined;
  return {
    data: query.data,
    status: hasData ? "ready" : query.isError ? "error" : "loading",
    refetchError: hasData && query.isError,
    isPlaceholder: query.isPlaceholderData,
    isFetching: query.isFetching,
    retry,
  };
}

// --- Window preference ------------------------------------------------------------------

const WINDOWS = [7, 30, 90] as const;
type HistoryWindow = (typeof WINDOWS)[number];
const WINDOW_STORAGE_KEY = "vacademy.engagement.pastWindow";

function readWindow(): HistoryWindow {
  try {
    const stored = Number(localStorage.getItem(WINDOW_STORAGE_KEY));
    return (WINDOWS as readonly number[]).includes(stored) ? (stored as HistoryWindow) : 30;
  } catch {
    return 30;
  }
}

function writeWindow(value: HistoryWindow): void {
  try {
    localStorage.setItem(WINDOW_STORAGE_KEY, String(value));
  } catch {
    // A convenience only; private windows may refuse storage.
  }
}

// --- View model --------------------------------------------------------------------------

interface DayGroup {
  date: string;
  rows: EngagementItem[];
  tally: DayTally;
}

interface PastView {
  catchable: EngagementItem[];
  groups: DayGroup[];
  tallies: Map<string, DayTally>;
  done: number;
  missed: number;
  catchUp: number;
  points: number;
  multiBatch: boolean;
}

function buildView(page: EngagementHistoryPage): PastView {
  const today = page.today;
  const catchable: EngagementItem[] = [];
  const byDay = new Map<string, EngagementItem[]>();
  const tallies = new Map<string, DayTally>();
  const batches = new Set<string>();
  let done = 0;
  let missed = 0;
  let catchUp = 0;
  let points = 0;

  for (const item of page.items) {
    const status = item.historyStatus ?? "MISSED";
    const day = item.runDate ?? "";
    // Today's finished tasks belong to the Today tab.
    if (status === "DONE" && day >= today) continue;
    if (item.packageSessionId) batches.add(item.packageSessionId);

    const tally = tallies.get(day) ?? { total: 0, done: 0, catchUp: 0 };
    tally.total += 1;
    if (status === "DONE") {
      tally.done += 1;
      done += 1;
      points += item.pointsAwarded ?? 0;
    } else if (status === "CATCH_UP") {
      tally.catchUp += 1;
      catchUp += 1;
    } else {
      missed += 1;
    }
    tallies.set(day, tally);

    if (status === "CATCH_UP") {
      catchable.push(item);
      continue;
    }
    const rows = byDay.get(day);
    if (rows) rows.push(item);
    else byDay.set(day, [item]);
  }

  // Soonest-closing catch-up first: that is the one to do now.
  const closesMs = (i: EngagementItem) => {
    const ms = Date.parse(i.catchUpClosesAt ?? "");
    return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
  };
  catchable.sort((a, b) => closesMs(a) - closesMs(b));

  const groups = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, rows]) => ({
      date,
      rows,
      tally: tallies.get(date) ?? { total: rows.length, done: 0, catchUp: 0 },
    }));

  return { catchable, groups, tallies, done, missed, catchUp, points, multiBatch: batches.size > 1 };
}

// --- Component ------------------------------------------------------------------------------

export interface PastTabProps {
  showPoints: boolean;
}

export function PastTab({ showPoints }: PastTabProps) {
  const { t } = useTranslation("dashboardEngagement");
  const [days, setDays] = useState<HistoryWindow>(readWindow);
  const history = useEngagementHistory(days);
  const host = useEngagementTaskHost();
  const skew = useServerClockSkew();
  const now = Date.now() + skew;

  const view = useMemo(() => (history.data ? buildView(history.data) : null), [history.data]);

  const openCatchUp = (item: EngagementItem) => {
    const queue = view?.catchable.map((i) => i.id) ?? [item.id];
    host.open(item.id, { queue, item });
  };

  const onWindowChange = (value: string) => {
    const next = Number(value) as HistoryWindow;
    if (!(WINDOWS as readonly number[]).includes(next)) return;
    setDays(next);
    writeWindow(next);
  };

  const windowPicker = (
    <ToggleGroup
      type="single"
      size="lg"
      value={String(days)}
      onValueChange={onWindowChange}
      aria-label={t("page.past.windowLabel")}
      className={ecn(
        "justify-start gap-1 rounded-lg bg-muted p-1",
        "[.ui-play_&]:rounded-play-btn [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep"
      )}
    >
      {WINDOWS.map((w) => (
        <ToggleGroupItem
          key={w}
          value={String(w)}
          className={ecn(
            "min-h-11 px-4 text-muted-foreground",
            "data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-sm",
            "[.ui-play_&]:data-[state=on]:text-play-ink [.ui-cleaner-play_&]:data-[state=on]:bg-cp-surface [.ui-cleaner-play_&]:data-[state=on]:text-cp-ink"
          )}
        >
          {t("page.past.window", { count: w })}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  if (history.status === "loading" || !history.data || !view) {
    if (history.status === "error") {
      return (
        <div className="flex flex-col gap-4">
          {windowPicker}
          <div className={ecn(skinClasses("card"), "p-card")}>
            <ErrorState title={t("page.past.error")} onRetry={history.retry} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4" aria-busy>
        {windowPicker}
        <LoadingState variant="list" count={5} />
      </div>
    );
  }

  const page = history.data;
  const tiles: StatTileData[] = [
    { id: "done", label: t("page.past.done"), value: formatNumber(view.done), icon: CheckCircle, tone: "success" },
    { id: "missed", label: t("page.past.missed"), value: formatNumber(view.missed), icon: MinusCircle, tone: "neutral" },
    { id: "catchUp", label: t("page.past.canCatchUp"), value: formatNumber(view.catchUp), icon: Hourglass, tone: "warn" },
  ];
  if (showPoints) {
    tiles.push({ id: "points", label: t("page.past.points"), value: formatNumber(view.points), icon: Star, tone: "accent" });
  }
  const empty = view.catchable.length === 0 && view.groups.length === 0;

  return (
    <div
      className={ecn(
        "flex flex-col gap-4 transition-opacity duration-150",
        history.isPlaceholder && "opacity-60"
      )}
      aria-busy={history.isFetching || undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {windowPicker}
      </div>

      {history.refetchError && (
        <ErrorState variant="inline" message={t("page.refreshError")} onRetry={history.retry} />
      )}

      <StatTiles tiles={tiles} label={t("page.past.summaryLabel", { count: days })} />

      {!empty && (
        <div className={ecn(skinClasses("card"), "p-3 sm:p-card")}>
          <DayStrip today={page.today} days={days} tallies={view.tallies} />
        </div>
      )}

      {view.catchable.length > 0 && (
        <section aria-labelledby="engagement-past-catchable" className="flex flex-col gap-2">
          <h2
            id="engagement-past-catchable"
            className={ecn("text-subtitle font-semibold", skinClasses("ink"))}
          >
            {t("page.past.stillCatchable", { count: view.catchable.length })}
          </h2>
          <ul
            className={ecn(
              skinClasses("card"),
              "divide-y divide-border overflow-hidden border-warning-200 [.ui-play_&]:border-play-warn [.ui-cleaner-play_&]:border-cp-gold [.ui-cleaner-play_&]:divide-cp-border"
            )}
          >
            {view.catchable.map((item) => (
              <PastRow
                key={`${item.id}-${item.runDate}`}
                item={item}
                timeZone={page.timezone}
                showPoints={showPoints}
                now={now}
                showBatch={view.multiBatch}
                onOpen={openCatchUp}
              />
            ))}
          </ul>
        </section>
      )}

      {empty ? (
        <div className={ecn(skinClasses("card"), "p-card")}>
          <EmptyState
            icon={ClockCounterClockwise}
            title={t("page.past.emptyTitle")}
            description={t("page.past.emptyBody")}
            compact
          />
        </div>
      ) : (
        view.groups.map((group) => {
          const headingId = `engagement-past-${group.date}`;
          return (
            <section key={group.date} aria-labelledby={headingId} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={headingId} className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
                  {isoDayHeading(group.date, page.today, t)}
                </h2>
                <p className={ecn("shrink-0 text-caption tabular-nums", skinClasses("mutedInk"))}>
                  {t("page.past.dayDone", { done: group.tally.done, count: group.tally.total })}
                </p>
              </div>
              <ul
                className={ecn(
                  skinClasses("card"),
                  "divide-y divide-border overflow-hidden [.ui-cleaner-play_&]:divide-cp-border"
                )}
              >
                {group.rows.map((item) => (
                  <PastRow
                    key={`${item.id}-${item.runDate}`}
                    item={item}
                    timeZone={page.timezone}
                    showPoints={showPoints}
                    now={now}
                    showBatch={view.multiBatch}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
