import { useEffect, useState } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";

/**
 * Server-side points (points_ledger). This is the authoritative figure.
 *
 * The older number in play-gamification.ts is computed in the browser from activity
 * logs and cached in localStorage, so it can never agree with a leaderboard or be
 * compared between learners. Prefer this wherever both are available.
 */

export interface PointsBreakdownItem {
  key: string;
  label: string;
  points: number;
}

/** One day of the last-seven-days strip, oldest first. */
export interface PointsStreakDay {
  /** yyyy-mm-dd in the institute's timezone, when the server sends it. */
  date: string | null;
  active: boolean;
}

export interface PointsSummary {
  totalPoints: number;
  weekPoints: number;
  todayPoints: number;
  level: number;
  pointsToNextLevel: number;
  breakdown: PointsBreakdownItem[];
  // ── Server streak (WP-2C). Optional: older servers send none. ────────
  /** Consecutive institute-local days with learning activity or points. */
  currentStreak?: number | null;
  longestStreak?: number | null;
  /** True once today already counts toward the streak. */
  keptToday?: boolean | null;
  /** Normalised by {@link normalizeLast7Days}; oldest first. */
  last7Days?: PointsStreakDay[] | null;
}

/**
 * Accept the shapes the streak strip may take — booleans, `{date, active}` objects
 * (or `kept` / `done`), or a list of active dates — and return `{date, active}`.
 */
export function normalizeLast7Days(raw: unknown): PointsStreakDay[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((entry): PointsStreakDay => {
    if (typeof entry === "boolean") return { date: null, active: entry };
    if (typeof entry === "string") return { date: entry, active: true };
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const date = typeof e.date === "string" ? e.date : null;
      const active = [e.active, e.kept, e.done, e.hasActivity].some((v) => v === true);
      return { date, active };
    }
    return { date: null, active: false };
  });
}

function optNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Fetch the learner's own points summary; null on any failure so callers can fall back. */
export async function fetchPointsSummary(
  instituteIdArg?: string | null
): Promise<PointsSummary | null> {
  try {
    const instituteId = instituteIdArg ?? (await getInstituteId());
    if (!instituteId) return null;
    const { data } = await authenticatedAxiosInstance.get(
      `${BASE_URL}/admin-core-service/points/v1/me/summary`,
      { params: { instituteId } }
    );
    if (!data || typeof data.totalPoints !== "number") return null;
    return {
      ...(data as PointsSummary),
      breakdown: Array.isArray(data.breakdown) ? data.breakdown : [],
      currentStreak: optNum(data.currentStreak),
      longestStreak: optNum(data.longestStreak),
      keptToday: typeof data.keptToday === "boolean" ? data.keptToday : null,
      last7Days: normalizeLast7Days(data.last7Days),
    };
  } catch (error) {
    console.error("[points] summary fetch failed:", error);
    return null;
  }
}

// ── React Query ──────────────────────────────────────────────────────

/** Prefix for every "my points" query. Invalidate this after anything that awards points. */
export const POINTS_ME_KEY = ["points", "me"] as const;

export function pointsMeKey(instituteId: string | null | undefined) {
  return [...POINTS_ME_KEY, instituteId ?? null] as const;
}

/**
 * The selected institute id. `undefined` while it is being resolved, `null` when
 * there is none.
 */
export function useCurrentInstituteId(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    getInstituteId()
      .then((value) => {
        if (active) setId(value || null);
      })
      .catch(() => {
        if (active) setId(null);
      });
    return () => {
      active = false;
    };
  }, []);
  return id;
}

/**
 * The learner's server points (and streak), shared by every surface that shows
 * them. `data` is null when the server could not answer; fall back to the
 * browser-computed gamification figures then.
 */
export function usePointsSummary(opts: { enabled?: boolean } = {}) {
  const instituteId = useCurrentInstituteId();
  return useQuery({
    queryKey: pointsMeKey(instituteId),
    queryFn: () => fetchPointsSummary(instituteId),
    enabled: (opts.enabled ?? true) && Boolean(instituteId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Move the cached summary by a just-awarded amount so every pill updates before the
 * refetch lands. `newTotal` wins when the server sent it.
 */
export function bumpCachedPoints(
  queryClient: QueryClient,
  awarded: number,
  newTotal?: number | null
): void {
  queryClient.setQueriesData<PointsSummary | null>({ queryKey: POINTS_ME_KEY }, (prev) => {
    if (!prev) return prev;
    const delta = Number.isFinite(awarded) ? awarded : 0;
    const total =
      typeof newTotal === "number" && Number.isFinite(newTotal)
        ? newTotal
        : prev.totalPoints + delta;
    const safeTotal = Math.max(0, total);
    return {
      ...prev,
      totalPoints: total,
      todayPoints: prev.todayPoints + delta,
      weekPoints: prev.weekPoints + delta,
      level: Math.floor(safeTotal / POINTS_PER_LEVEL) + 1,
      pointsToNextLevel: POINTS_PER_LEVEL - (safeTotal % POINTS_PER_LEVEL),
    };
  });
}

/** Mirrors PointsLedgerService.POINTS_PER_LEVEL and XP_PER_LEVEL in play-gamification.ts. */
const POINTS_PER_LEVEL = 500;

/** The submit-result fields the points cache reads (EngagementSubmitResponse fits). */
export interface PointsAwardResult {
  attemptId?: string | null;
  pointsAwarded?: number | null;
  newTotalPoints?: number | null;
  alreadyCompleted?: boolean | null;
}

/** Results already applied in this page session, so two listeners never add twice. */
const appliedResults: string[] = [];
const MAX_APPLIED_RESULTS = 50;

/**
 * Move `['points','me']` by one task result, once. Several surfaces may see the same
 * result (the submit hook and the pill's result listener), so a result is keyed by
 * attempt, award and new total and applied only the first time. A repeat submit
 * (`alreadyCompleted`) adds nothing. Returns true when the cache was moved.
 */
export function applyResultToPointsCache(
  queryClient: QueryClient,
  r: PointsAwardResult | null | undefined
): boolean {
  if (!r || r.alreadyCompleted === true) return false;
  const awarded = Number(r.pointsAwarded ?? 0);
  const delta = Number.isFinite(awarded) && awarded > 0 ? awarded : 0;
  const hasTotal = typeof r.newTotalPoints === "number" && Number.isFinite(r.newTotalPoints);
  if (delta === 0 && !hasTotal) return false;
  if (r.attemptId) {
    const key = `${r.attemptId}|${delta}|${hasTotal ? r.newTotalPoints : ""}`;
    if (appliedResults.includes(key)) return false;
    appliedResults.push(key);
    if (appliedResults.length > MAX_APPLIED_RESULTS) appliedResults.shift();
  }
  bumpCachedPoints(queryClient, delta, hasTotal ? r.newTotalPoints : null);
  return true;
}
