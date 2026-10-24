import { useCallback } from "react";
import axios from "axios";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { GET_SERVER_TIME } from "@/constants/urls";
import {
  engagementReasonAction,
  engagementReasonCode,
  fetchEngagementFeedOrThrow,
  submitEngagementItem,
  type EngagementFeed,
  type EngagementItem,
  type EngagementSubmitRequest,
  type EngagementSubmitResponse,
} from "@/services/engagement";
import { POINTS_ME_KEY, applyResultToPointsCache, useCurrentInstituteId } from "@/services/points";
import { useEngagementDraftStore } from "./engagement-draft-store";

/**
 * The learner's engagement data layer (D31, D32, D46, D2).
 *
 * - `useEngagementFeed()`: today's feed through React Query. Keeps the last good
 *   data on a failed refresh, refetches on focus, and schedules the next refetch
 *   for the next time boundary (a task opening, closing or revealing, or midnight),
 *   measured on the server clock.
 * - `useSubmitEngagement()`: submits a task, marks it done in the cache at once
 *   (in place: the row does not jump), moves the points everywhere, then refetches.
 */

// ── Keys ─────────────────────────────────────────────────────────────

/** Prefix of every feed query; invalidate this to refresh the feed everywhere. */
export const ENGAGEMENT_FEED_KEY = ["engagement", "feed"] as const;
/** Prefix reserved for history queries (the /engagement page). */
export const ENGAGEMENT_HISTORY_KEY = ["engagement", "history"] as const;

export function engagementFeedKey(instituteId: string | null | undefined): QueryKey {
  return [...ENGAGEMENT_FEED_KEY, instituteId ?? null];
}

// ── Server clock ─────────────────────────────────────────────────────

const SERVER_SKEW_KEY = ["server-time", "skew"] as const;

async function fetchServerSkewMs(): Promise<number> {
  try {
    const start = Date.now();
    const { data } = await axios.get<{ timestamp?: number }>(GET_SERVER_TIME);
    const end = Date.now();
    if (typeof data?.timestamp !== "number") return 0;
    return data.timestamp + (end - start) / 2 - end;
  } catch {
    return 0;
  }
}

/**
 * Milliseconds to add to `Date.now()` to get the server's time. 0 until known or
 * when the server-time call fails. Shared by every caller through the query cache.
 */
export function useServerClockSkew(): number {
  const { data } = useQuery({
    queryKey: SERVER_SKEW_KEY,
    queryFn: fetchServerSkewMs,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return data ?? 0;
}

// ── Boundaries ───────────────────────────────────────────────────────

/** Refetch no sooner than this after a boundary, so a burst of them costs one call. */
const MIN_REFETCH_MS = 15_000;
/** Refetch at least this often, so a plan published later still shows up. */
const MAX_REFETCH_MS = 10 * 60_000;
/** Land just after the boundary, when the server already sees the new state. */
const BOUNDARY_SLACK_MS = 2_000;

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * The next instant after `nowMs` at which the feed changes on its own: a task
 * opening, closing, revealing, a catch-up window closing, or the next midnight
 * (device calendar, server clock). Pure; `nowMs` is server time.
 */
export function nextFeedBoundary(feed: EngagementFeed | null | undefined, nowMs: number): number {
  const midnight = new Date(nowMs);
  midnight.setHours(24, 0, 0, 0);
  let next = midnight.getTime();
  const consider = (iso: string | null | undefined) => {
    const t = toMs(iso);
    if (t !== null && t > nowMs && t < next) next = t;
  };
  if (feed) {
    const rows: EngagementItem[] = [
      ...feed.items,
      ...feed.catchUp,
      ...feed.upcoming,
      ...feed.doneToday,
    ];
    for (const item of rows) {
      consider(item.opensAt);
      consider(item.closesAt);
      consider(item.revealAt);
      consider(item.catchUpClosesAt);
    }
    consider(feed.catchUpClosesAt);
  }
  return next;
}

/** How long to wait before the next scheduled refetch. Pure; `nowMs` is server time. */
export function feedRefetchDelay(feed: EngagementFeed | null | undefined, nowMs: number): number {
  const wait = nextFeedBoundary(feed, nowMs) - nowMs + BOUNDARY_SLACK_MS;
  return Math.min(MAX_REFETCH_MS, Math.max(MIN_REFETCH_MS, wait));
}

// ── Feed ─────────────────────────────────────────────────────────────

export type EngagementFeedStatus = "loading" | "ready" | "error";

export interface UseEngagementFeedResult {
  /** undefined while loading or after a first-load error; null when no plan is running. */
  feed: EngagementFeed | null | undefined;
  /** `error` only when there is no data to show (first load failed). */
  status: EngagementFeedStatus;
  /** A background refresh failed while older data is still shown. */
  refetchError: boolean;
  isFetching: boolean;
  retry: () => void;
  /** The server's current time in ms (device clock corrected by the measured skew). */
  serverNow: () => number;
}

export function useEngagementFeed(opts: { enabled?: boolean } = {}): UseEngagementFeedResult {
  const instituteId = useCurrentInstituteId();
  const skew = useServerClockSkew();
  const enabled = (opts.enabled ?? true) && Boolean(instituteId);

  const query = useQuery({
    queryKey: engagementFeedKey(instituteId),
    queryFn: () => fetchEngagementFeedOrThrow(instituteId),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: 1,
    refetchInterval: (q) => feedRefetchDelay(q.state.data, Date.now() + skew),
  });

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const serverNow = useCallback(() => Date.now() + skew, [skew]);

  // No institute selected: nothing to fetch, nothing to show.
  if (instituteId === null) {
    return { feed: null, status: "ready", refetchError: false, isFetching: false, retry, serverNow };
  }
  const hasData = query.data !== undefined;
  let status: EngagementFeedStatus;
  if (hasData) status = "ready";
  else if (query.isError) status = "error";
  else status = "loading";
  return {
    feed: query.data,
    status,
    refetchError: hasData && query.isError,
    isFetching: query.isFetching,
    retry,
    serverNow,
  };
}

/** Find a task anywhere in the feed (today, catch-up, done, revealed). */
export function findEngagementItem(
  feed: EngagementFeed | null | undefined,
  itemId: string
): EngagementItem | undefined {
  if (!feed) return undefined;
  return (
    feed.items.find((i) => i.id === itemId) ??
    feed.catchUp.find((i) => i.id === itemId) ??
    feed.doneToday.find((i) => i.id === itemId) ??
    feed.revealed.find((i) => i.id === itemId)
  );
}

// ── Cache patches (pure) ─────────────────────────────────────────────

function isCompleted(item: EngagementItem | undefined): boolean {
  return (item?.attemptStatus ?? "").toUpperCase() === "COMPLETED";
}

function patchRows(
  rows: EngagementItem[],
  itemId: string,
  patch: Partial<EngagementItem>
): EngagementItem[] {
  let changed = false;
  const next = rows.map((row) => {
    if (row.id !== itemId) return row;
    changed = true;
    return { ...row, ...patch };
  });
  return changed ? next : rows;
}

/**
 * Optimistic step: mark the task done where it sits (it stays in `items`, so an
 * "Up next" row does not jump), add it to `doneToday`, and count it once toward
 * today's progress when it is one of today's tasks.
 */
export function markEngagementItemDone(
  feed: EngagementFeed,
  itemId: string,
  patch: Partial<EngagementItem> = {}
): EngagementFeed {
  const todayRow = feed.items.find((i) => i.id === itemId);
  const row = todayRow ?? feed.catchUp.find((i) => i.id === itemId);
  if (!row) return feed;
  const donePatch: Partial<EngagementItem> = { ...patch, attemptStatus: "COMPLETED" };
  const wasDone = isCompleted(row);
  const doneRow = { ...row, ...donePatch };
  const inDone = feed.doneToday.some((i) => i.id === itemId);
  return {
    ...feed,
    items: patchRows(feed.items, itemId, donePatch),
    catchUp: patchRows(feed.catchUp, itemId, donePatch),
    doneToday: inDone ? patchRows(feed.doneToday, itemId, donePatch) : [...feed.doneToday, doneRow],
    completedToday: todayRow && !wasDone ? feed.completedToday + 1 : feed.completedToday,
  };
}

/** The fields of a submit result that belong on the task row. */
export function resultPatch(
  r: EngagementSubmitResponse,
  req?: EngagementSubmitRequest
): Partial<EngagementItem> {
  const patch: Partial<EngagementItem> = {
    attemptStatus: r.status || "COMPLETED",
    isCorrect: r.resultPending ? null : r.isCorrect ?? null,
    resultPending: r.resultPending ?? null,
    isLate: r.isLate,
    isRevealed: r.isRevealed,
  };
  if (r.alreadyCompleted !== true) patch.pointsAwarded = r.pointsAwarded;
  if (req?.selectedOptionId) patch.selectedOptionId = req.selectedOptionId;
  if (r.correctOptionId) patch.correctOptionId = r.correctOptionId;
  if (r.explanation) patch.explanation = r.explanation;
  if (r.pollResults) patch.pollResults = r.pollResults;
  if (typeof r.responseCount === "number") patch.responseCount = r.responseCount;
  if (r.flashcardsResult) patch.flashcardsResult = r.flashcardsResult;
  if (r.answerAlreadyOut === true) patch.answerAlreadyOut = true;
  return patch;
}

/**
 * Undo {@link markEngagementItemDone} for ONE task after its submit failed, leaving
 * every other change since the snapshot alone (another task answered meanwhile, or a
 * refetch). `before` is that feed as it was just before the optimistic step.
 */
export function revertEngagementItem(
  current: EngagementFeed,
  before: EngagementFeed,
  itemId: string
): EngagementFeed {
  // Replace the row whole: a merge would keep fields the optimistic step added.
  const replace = (rows: EngagementItem[], prev: EngagementItem) =>
    rows.map((row) => (row.id === itemId ? prev : row));
  const restore = (rows: EngagementItem[], prevRows: EngagementItem[]) => {
    const prev = prevRows.find((i) => i.id === itemId);
    return prev ? replace(rows, prev) : rows;
  };
  const prevDone = before.doneToday.find((i) => i.id === itemId);
  const beforeRow = before.items.find((i) => i.id === itemId);
  const currentRow = current.items.find((i) => i.id === itemId);
  // The optimistic step counted it only for a today task that was not done yet.
  const counted = Boolean(beforeRow && !isCompleted(beforeRow) && isCompleted(currentRow));
  return {
    ...current,
    items: restore(current.items, before.items),
    catchUp: restore(current.catchUp, before.catchUp),
    doneToday: prevDone
      ? replace(current.doneToday, prevDone)
      : current.doneToday.filter((i) => i.id !== itemId),
    completedToday: counted ? Math.max(0, current.completedToday - 1) : current.completedToday,
  };
}

type FeedSnapshot = Array<[QueryKey, EngagementFeed | null | undefined]>;

function patchAllFeeds(
  queryClient: QueryClient,
  update: (feed: EngagementFeed) => EngagementFeed
): void {
  queryClient.setQueriesData<EngagementFeed | null>({ queryKey: ENGAGEMENT_FEED_KEY }, (prev) =>
    prev ? update(prev) : prev
  );
}

// ── Submit ───────────────────────────────────────────────────────────

/**
 * Submit a task. Resolves with the server's response; rejects with the request
 * error (read it with `engagementErrorMessage`). On success:
 * - the task is marked done in every cached feed, in place, with its result;
 * - the points move in the gamification store and the display cache (inside
 *   submitEngagementItem) and in `['points','me']`;
 * - the task's draft is cleared;
 * - the feed and the points are refetched.
 * On failure the optimistic change to THIS task is rolled back, and a refusal that ends the task
 * (TASK_CLOSED, NOT_OPEN, UNSUPPORTED_TYPE) refetches the feed.
 *
 * Keeping the answered task pinned as "Up next" is the caller's job
 * (`usePinnedUpNext` in engagement-draft-store): the refetch moves it to `doneToday`.
 */
export function useSubmitEngagement(): (
  itemId: string,
  req: EngagementSubmitRequest
) => Promise<EngagementSubmitResponse> {
  const queryClient = useQueryClient();

  return useCallback(
    async (itemId: string, req: EngagementSubmitRequest) => {
      await queryClient.cancelQueries({ queryKey: ENGAGEMENT_FEED_KEY });
      const snapshot: FeedSnapshot = queryClient.getQueriesData<EngagementFeed | null>({
        queryKey: ENGAGEMENT_FEED_KEY,
      });
      patchAllFeeds(queryClient, (feed) => markEngagementItemDone(feed, itemId));

      let response: EngagementSubmitResponse;
      try {
        response = await submitEngagementItem(itemId, req);
      } catch (error) {
        // Roll back this task only; other tasks' optimistic results stay.
        for (const [key, before] of snapshot) {
          queryClient.setQueryData<EngagementFeed | null>(key, (current) =>
            current && before ? revertEngagementItem(current, before, itemId) : before
          );
        }
        if (engagementReasonAction(engagementReasonCode(error)) === "close") {
          void queryClient.invalidateQueries({ queryKey: ENGAGEMENT_FEED_KEY });
        }
        throw error;
      }

      const patch = resultPatch(response, req);
      patchAllFeeds(queryClient, (feed) => markEngagementItemDone(feed, itemId, patch));

      // submitEngagementItem already moved the gamification store. The pill's result
      // listener may already have moved ['points','me']; this applies it at most once.
      applyResultToPointsCache(queryClient, response);
      useEngagementDraftStore.getState().clear(itemId);

      void queryClient.invalidateQueries({ queryKey: ENGAGEMENT_FEED_KEY });
      void queryClient.invalidateQueries({ queryKey: ENGAGEMENT_HISTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: POINTS_ME_KEY });
      return response;
    },
    [queryClient]
  );
}
