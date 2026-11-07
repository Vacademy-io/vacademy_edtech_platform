import { describe, expect, it, vi } from "vitest";

vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.test", GET_SERVER_TIME: "https://api.test/time" }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

const { withEngagementResult, usePlayGamificationStore } = await import("./play-gamification-store");
const { celebrationKindFor } = await import("@/lib/play-celebration");
const { normalizeLast7Days } = await import("@/services/points");
const { applyServerPoints, computeGamificationData } = await import("@/services/play-gamification");
type PlayGamificationData = import("@/services/play-gamification").PlayGamificationData;

const data: PlayGamificationData = {
  currentStreak: 0,
  longestStreak: 0,
  lastActivityDate: null,
  weeklyDots: Array(7).fill(false),
  totalXp: 490,
  todayXp: 5,
  level: 1,
  xpToNextLevel: 10,
  badges: [],
};

const result = {
  attemptId: "a",
  status: "COMPLETED",
  pointsAwarded: 20,
  isLate: false,
  isVerified: true,
  isRevealed: false,
};

describe("withEngagementResult", () => {
  it("takes the server total and adds the award to today", () => {
    const next = withEngagementResult(data, { ...result, newTotalPoints: 510 });
    expect(next.totalXp).toBe(510);
    expect(next.todayXp).toBe(25);
    expect(next.level).toBe(2);
    expect(next.xpToNextLevel).toBe(490);
  });

  it("adds locally when the server sent no total", () => {
    expect(withEngagementResult(data, result).totalXp).toBe(510);
  });

  it("does nothing for a repeat or a zero award", () => {
    expect(withEngagementResult(data, { ...result, alreadyCompleted: true })).toBe(data);
    expect(withEngagementResult(data, { ...result, pointsAwarded: 0 })).toBe(data);
  });

  it("updates the store and records the award for the +N pop", () => {
    const store = usePlayGamificationStore;
    store.setState({ data, lastAward: null });
    store.getState().applyEngagementResult({ ...result, newTotalPoints: 510 });
    expect(store.getState().data?.totalXp).toBe(510);
    expect(store.getState().lastAward).toEqual({ points: 20, seq: 1 });
    store.setState({ data: null });
    store.getState().applyEngagementResult(result);
    expect(store.getState().data).toBeNull();
  });
});

describe("celebrationKindFor", () => {
  it("celebrates correct answers and ungraded completions only", () => {
    expect(celebrationKindFor({ isCorrect: true, pointsAwarded: 30 })).toBe("correct");
    expect(celebrationKindFor({ isCorrect: null, pointsAwarded: 10 })).toBe("complete");
    expect(celebrationKindFor({ isCorrect: false, pointsAwarded: 10 })).toBeNull();
    expect(celebrationKindFor({ resultPending: true, pointsAwarded: 10 })).toBeNull();
    expect(celebrationKindFor({ alreadyCompleted: true, isCorrect: true })).toBeNull();
    expect(celebrationKindFor({ pointsAwarded: 0 })).toBeNull();
  });
});

describe("server streak", () => {
  it("normalises the last-7-days strip", () => {
    expect(normalizeLast7Days([true, false])).toEqual([
      { date: null, active: true },
      { date: null, active: false },
    ]);
    expect(normalizeLast7Days([{ date: "2026-09-25", kept: true }, "2026-09-26"])).toEqual([
      { date: "2026-09-25", active: true },
      { date: "2026-09-26", active: true },
    ]);
    expect(normalizeLast7Days(undefined)).toBeNull();
  });

  it("drives the streak points line and badge from the server streak", () => {
    const computed = computeGamificationData({
      dashboard: null,
      activities: [],
      attendance: null,
      instituteId: "i",
      serverStreak: { currentStreak: 0, longestStreak: 4 },
    });
    expect(computed.currentStreak).toBe(0);
    expect(computed.longestStreak).toBe(4);
    expect(computed.streakSource).toBe("server");
    const streakLine = computed.xpBreakdown?.find((b) => b.key === "streak");
    expect(streakLine?.points ?? 0).toBe(0);
  });

  it("overlays the server summary", () => {
    const next = applyServerPoints(data, {
      totalPoints: 900,
      weekPoints: 50,
      todayPoints: 20,
      level: 2,
      pointsToNextLevel: 100,
      breakdown: [],
      currentStreak: 3,
      longestStreak: 2,
      keptToday: false,
      last7Days: null,
    });
    expect(next.totalXp).toBe(900);
    expect(next.currentStreak).toBe(3);
    expect(next.longestStreak).toBe(3);
    expect(next.keptToday).toBe(false);
    expect(applyServerPoints(data, null)).toBe(data);
  });
});
