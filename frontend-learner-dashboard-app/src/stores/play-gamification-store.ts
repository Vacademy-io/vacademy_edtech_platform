import { create } from "zustand";
import {
  PlayGamificationData,
  getCachedGamification,
  setCachedGamification,
} from "@/services/play-gamification";
import type { EngagementSubmitResponse } from "@/services/engagement";

interface PlayGamificationStore {
  data: PlayGamificationData | null;
  isLoading: boolean;
  /**
   * The last points delta applied from a task result, so play skins can animate
   * "+N". `seq` changes on every award, even two equal ones in a row.
   */
  lastAward: { points: number; seq: number } | null;
  setData: (data: PlayGamificationData) => void;
  loadFromCache: (instituteId: string) => void;
  /**
   * Move the points by a task result without a reload: total = the server's new
   * total, today += awarded. A no-op for repeats (`alreadyCompleted`), zero awards
   * and before any data has loaded. With `instituteId` the display cache is updated
   * too, so other pages agree on their next fresh load.
   */
  applyEngagementResult: (r: EngagementSubmitResponse, instituteId?: string | null) => void;
}

/** Mirrors XP_PER_LEVEL in play-gamification.ts and the server's POINTS_PER_LEVEL. */
const XP_PER_LEVEL = 500;

const DEFAULT_DATA: PlayGamificationData = {
  currentStreak: 0,
  longestStreak: 0,
  lastActivityDate: null,
  weeklyDots: Array(7).fill(false),
  totalXp: 0,
  todayXp: 0,
  level: 1,
  xpToNextLevel: XP_PER_LEVEL,
  badges: [],
};

/** Pure: the snapshot after one task result, or the same object when nothing changes. */
export function withEngagementResult(
  data: PlayGamificationData,
  r: EngagementSubmitResponse
): PlayGamificationData {
  if (r.alreadyCompleted === true) return data;
  const awarded = Number(r.pointsAwarded ?? 0);
  const delta = Number.isFinite(awarded) && awarded > 0 ? awarded : 0;
  const serverTotal =
    typeof r.newTotalPoints === "number" && Number.isFinite(r.newTotalPoints)
      ? r.newTotalPoints
      : null;
  if (delta === 0 && (serverTotal === null || serverTotal === data.totalXp)) return data;
  const totalXp = serverTotal ?? data.totalXp + delta;
  const safeTotal = Math.max(0, totalXp);
  return {
    ...data,
    totalXp,
    todayXp: (data.todayXp ?? 0) + delta,
    level: Math.floor(safeTotal / XP_PER_LEVEL) + 1,
    xpToNextLevel: XP_PER_LEVEL - (safeTotal % XP_PER_LEVEL),
  };
}

export const usePlayGamificationStore = create<PlayGamificationStore>(
  (set, get) => ({
    data: null,
    isLoading: true,
    lastAward: null,

    setData: (data) => set({ data, isLoading: false }),

    loadFromCache: (instituteId) => {
      const cached = getCachedGamification(instituteId);
      set({ data: cached ?? DEFAULT_DATA, isLoading: false });
    },

    applyEngagementResult: (r, instituteId) => {
      const current = get().data;
      if (!current) return;
      const next = withEngagementResult(current, r);
      if (next === current) return;
      const delta = next.todayXp - (current.todayXp ?? 0);
      set({
        data: next,
        lastAward:
          delta > 0 ? { points: delta, seq: (get().lastAward?.seq ?? 0) + 1 } : get().lastAward,
      });
      if (instituteId) setCachedGamification(instituteId, next);
    },
  })
);
