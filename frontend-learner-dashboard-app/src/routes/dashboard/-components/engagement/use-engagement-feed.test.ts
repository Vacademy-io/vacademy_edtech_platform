import { describe, expect, it, vi } from "vitest";

vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.test", GET_SERVER_TIME: "https://api.test/time" }));
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/constants/helper", () => ({ getInstituteId: async () => "inst-1" }));
vi.mock("@/stores/play-gamification-store", () => ({
  usePlayGamificationStore: { getState: () => ({ applyEngagementResult: () => {} }) },
}));

const {
  nextFeedBoundary,
  feedRefetchDelay,
  markEngagementItemDone,
  revertEngagementItem,
  resultPatch,
  findEngagementItem,
} = await import("./use-engagement-feed");
const { applyResultToPointsCache } = await import("@/services/points");
const { normalizeEngagementFeed } = await import("@/services/engagement");
type EngagementItem = import("@/services/engagement").EngagementItem;

function item(id: string, over: Partial<EngagementItem> = {}): EngagementItem {
  return {
    id,
    slotId: "s",
    planId: "p",
    packageSessionId: "ps",
    itemType: "QUESTION_OF_DAY",
    title: id,
    version: 1,
    sortOrder: 0,
    isRequired: false,
    completionPoints: 10,
    correctPoints: 20,
    state: "OPEN",
    ...over,
  };
}

const NOW = new Date(2026, 8, 26, 10, 0, 0).getTime(); // 10:00 local

describe("nextFeedBoundary", () => {
  it("is the next local midnight when nothing else is due", () => {
    expect(nextFeedBoundary(null, NOW)).toBe(new Date(2026, 8, 27, 0, 0, 0).getTime());
  });

  it("picks the earliest future open, close or reveal", () => {
    const at = (h: number) => new Date(2026, 8, 26, h, 0, 0).toISOString();
    const feed = normalizeEngagementFeed({
      items: [item("a", { closesAt: at(18), revealAt: at(20) })],
      upcoming: [item("u", { state: "UPCOMING", opensAt: at(14) })],
      doneToday: [item("d", { revealAt: at(9) })], // already past: ignored
    });
    expect(nextFeedBoundary(feed, NOW)).toBe(new Date(2026, 8, 26, 14, 0, 0).getTime());
  });

  it("clamps the refetch delay", () => {
    const soon = new Date(NOW + 1_000).toISOString();
    const feed = normalizeEngagementFeed({ items: [item("a", { closesAt: soon })] });
    expect(feedRefetchDelay(feed, NOW)).toBe(15_000);
    expect(feedRefetchDelay(null, NOW)).toBe(10 * 60_000);
  });
});

describe("markEngagementItemDone", () => {
  const feed = normalizeEngagementFeed({
    items: [item("a"), item("b")],
    catchUp: [item("late", { state: "CATCH_UP" })],
    completedToday: 2,
    scheduledToday: 4,
  });

  it("marks a today task done in place and counts it once", () => {
    const once = markEngagementItemDone(feed, "a");
    expect(once.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(once.items[0].attemptStatus).toBe("COMPLETED");
    expect(once.doneToday.map((i) => i.id)).toEqual(["a"]);
    expect(once.completedToday).toBe(3);
    expect(once.scheduledToday).toBe(4);

    const twice = markEngagementItemDone(once, "a", { isCorrect: true, pointsAwarded: 30 });
    expect(twice.completedToday).toBe(3);
    expect(twice.doneToday).toHaveLength(1);
    expect(twice.doneToday[0].isCorrect).toBe(true);
    expect(twice.items[0].pointsAwarded).toBe(30);
  });

  it("never counts a catch-up toward today", () => {
    const next = markEngagementItemDone(feed, "late");
    expect(next.completedToday).toBe(2);
    expect(next.catchUp[0].attemptStatus).toBe("COMPLETED");
    expect(findEngagementItem(next, "late")?.id).toBe("late");
  });

  it("ignores unknown ids", () => {
    expect(markEngagementItemDone(feed, "nope")).toBe(feed);
  });
});

describe("resultPatch", () => {
  const base = {
    attemptId: "x",
    status: "COMPLETED",
    pointsAwarded: 10,
    isLate: false,
    isVerified: true,
    isRevealed: false,
  };

  it("hides correctness while the result is pending", () => {
    const patch = resultPatch({ ...base, isCorrect: true, resultPending: true }, { selectedOptionId: "o1" });
    expect(patch.isCorrect).toBeNull();
    expect(patch.resultPending).toBe(true);
    expect(patch.selectedOptionId).toBe("o1");
  });

  it("does not overwrite the points on a repeat submit", () => {
    const patch = resultPatch({ ...base, pointsAwarded: 0, alreadyCompleted: true });
    expect("pointsAwarded" in patch).toBe(false);
  });
});

describe("revertEngagementItem", () => {
  const before = normalizeEngagementFeed({
    items: [item("a"), item("b")],
    catchUp: [item("late", { state: "CATCH_UP" })],
    completedToday: 1,
    scheduledToday: 3,
  });

  it("undoes one task's optimistic step and keeps another task's", () => {
    // a and b both submitted; a's submit then fails.
    const both = markEngagementItemDone(markEngagementItemDone(before, "a"), "b", { pointsAwarded: 10 });
    expect(both.completedToday).toBe(3);
    const reverted = revertEngagementItem(both, before, "a");
    expect(reverted.items[0]).toEqual(before.items[0]); // no leftover attemptStatus
    expect(reverted.items[1].attemptStatus).toBe("COMPLETED");
    expect(reverted.doneToday.map((i) => i.id)).toEqual(["b"]);
    expect(reverted.completedToday).toBe(2);
  });

  it("never uncounts a catch-up", () => {
    const next = markEngagementItemDone(before, "late");
    const reverted = revertEngagementItem(next, before, "late");
    expect(reverted.completedToday).toBe(1);
    expect(reverted.catchUp[0].attemptStatus).toBeUndefined();
    expect(reverted.doneToday).toEqual([]);
  });
});

describe("applyResultToPointsCache", () => {
  type Summary = { totalPoints: number; todayPoints: number; weekPoints: number; level: number; pointsToNextLevel: number; breakdown: [] };
  function fakeClient(initial: Summary) {
    let value: Summary | null = initial;
    return {
      client: {
        setQueriesData: (_f: unknown, fn: (prev: Summary | null) => Summary | null) => {
          value = fn(value);
        },
      } as unknown as Parameters<typeof applyResultToPointsCache>[0],
      get: () => value,
    };
  }
  const summary: Summary = { totalPoints: 100, todayPoints: 0, weekPoints: 0, level: 1, pointsToNextLevel: 400, breakdown: [] };

  it("applies one result once, however many listeners see it", () => {
    const { client, get } = fakeClient(summary);
    const r = { attemptId: "att-1", pointsAwarded: 20, newTotalPoints: 120 };
    expect(applyResultToPointsCache(client, r)).toBe(true);
    expect(applyResultToPointsCache(client, r)).toBe(false);
    expect(get()?.totalPoints).toBe(120);
    expect(get()?.todayPoints).toBe(20);
  });

  it("adds nothing for a repeat submit or an empty result", () => {
    const { client, get } = fakeClient(summary);
    expect(applyResultToPointsCache(client, { attemptId: "att-2", pointsAwarded: 20, alreadyCompleted: true })).toBe(false);
    expect(applyResultToPointsCache(client, { attemptId: "att-3", pointsAwarded: 0 })).toBe(false);
    expect(applyResultToPointsCache(client, undefined)).toBe(false);
    expect(get()).toEqual(summary);
  });
});
