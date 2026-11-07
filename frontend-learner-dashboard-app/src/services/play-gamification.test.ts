// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Node ≥ 22 ships an experimental `localStorage` global that is `undefined`
// unless --localstorage-file is passed, and it shadows jsdom's implementation.
// Fall back to a tiny in-memory Storage so the cache round-trip is testable.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}
if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true });
}
if (!globalThis.sessionStorage) {
  Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage(), configurable: true });
}

// badge-config pulls the axios instance + BASE_URL at module scope; stub the
// network-facing bits so this stays a pure unit test of the computation.
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { get: vi.fn() } }));
vi.mock("@/constants/urls", () => ({ BASE_URL: "http://test" }));
vi.mock("@/constants/helper", () => ({ getInstituteId: vi.fn(async () => "inst-1") }));
vi.mock("@/services/institute-settings-cache", () => ({
  instituteSettingsCache: { getCachedSettings: vi.fn(async () => null) },
}));

import type { BadgeDefinitionConfig, BadgesRewardsConfig } from "@/services/badge-config";
import type { AwardedBadge } from "@/services/awarded-badges";
import {
  computeBadges,
  computeGamificationData,
  findNewlyUnlockedBadges,
  findNewlyUnlockedSince,
  readCelebrationBaseline,
  writeCelebrationBaseline,
  getCachedGamification,
  shouldCelebrateBadge,
  type BadgeEvalContext,
  type PlayBadge,
  type PlayGamificationData,
} from "./play-gamification";

const ctx: BadgeEvalContext = {
  courses: 2,
  slides: 0,
  streak: 0,
  totalXp: 0,
  maxCourseCompletionPct: 0,
  bestAssessmentScorePct: null,
  liveSessionCount: 0,
  liveSessionStreak: 0,
};

function def(partial: Partial<BadgeDefinitionConfig> & { id: string }): BadgeDefinitionConfig {
  return {
    name: partial.id,
    description: "",
    icon: "Star",
    trigger: "course_count",
    threshold: 1,
    enabled: true,
    ...partial,
  };
}

function award(partial: Partial<AwardedBadge> & { badgeId: string }): AwardedBadge {
  return {
    id: `award-${partial.badgeId}`,
    userId: "u1",
    instituteId: "inst-1",
    status: "ACTIVE",
    awardedAt: "2026-09-01T00:00:00Z",
    ...partial,
  };
}

function cfg(badges: BadgeDefinitionConfig[]): BadgesRewardsConfig {
  return { version: 1, enabled: true, badges };
}

describe("computeBadges — manual trigger", () => {
  it("stays locked with progress 0 when there is no award, even with stats that would unlock an auto badge", () => {
    const [b] = computeBadges(cfg([def({ id: "star", trigger: "manual", threshold: 0 })]), ctx, []);
    expect(b).toBeDefined();
    expect(b!.unlocked).toBe(false);
    expect(b!.isAdminAwarded).toBe(false);
    expect(b!.progressCurrent).toBe(0);
    expect(b!.trigger).toBe("manual");
  });

  it("unlocks as admin-awarded when a MANUAL award exists, keeping the reason", () => {
    const [b] = computeBadges(
      cfg([def({ id: "star", trigger: "manual", threshold: 0 })]),
      ctx,
      [award({ badgeId: "star", source: "MANUAL", reason: "Great mentor" })]
    );
    expect(b!.unlocked).toBe(true);
    expect(b!.isAdminAwarded).toBe(true);
    expect(b!.awardReason).toBe("Great mentor");
    expect(b!.source).toBe("MANUAL");
    expect(b!.unlockedAt).toBe("2026-09-01T00:00:00Z");
  });

  it("treats an award with no source (older server) as a staff award", () => {
    const [b] = computeBadges(
      cfg([def({ id: "star", trigger: "manual", threshold: 0 })]),
      ctx,
      [award({ badgeId: "star", reason: "Legacy" })]
    );
    expect(b!.isAdminAwarded).toBe(true);
    expect(b!.awardReason).toBe("Legacy");
    expect(b!.source).toBeUndefined();
  });
});

describe("computeBadges — AUTO source rows", () => {
  it("unlocks the badge but does NOT mark it admin-awarded", () => {
    // course_count threshold 5 is NOT met by ctx.courses=2; the synced AUTO row still unlocks it.
    const [b] = computeBadges(
      cfg([def({ id: "five", trigger: "course_count", threshold: 5 })]),
      ctx,
      [award({ badgeId: "five", source: "AUTO" })]
    );
    expect(b!.unlocked).toBe(true);
    expect(b!.isAdminAwarded).toBe(false);
    expect(b!.awardReason).toBeNull();
    expect(b!.source).toBe("AUTO");
  });

  it("orphan AUTO rows (badge removed from config) render unlocked without the staff star", () => {
    const badges = computeBadges(cfg([]), ctx, [
      award({ badgeId: "gone", source: "AUTO", badgeName: "Gone", badgeIcon: "Fire" }),
      award({ badgeId: "gone-manual", source: "MANUAL", badgeName: "Kept", reason: "r" }),
    ]);
    expect(badges.map((b) => [b.id, b.unlocked, b.isAdminAwarded])).toEqual([
      ["gone", true, false],
      ["gone-manual", true, true],
    ]);
    expect(badges[1]!.awardReason).toBe("r");
  });

  it("auto badges still auto-unlock from stats with no award row at all", () => {
    const [b] = computeBadges(cfg([def({ id: "one", threshold: 1 })]), ctx, []);
    expect(b!.unlocked).toBe(true);
    expect(b!.isAdminAwarded).toBe(false);
    expect(b!.progressCurrent).toBe(2);
  });
});

describe("computeBadges — hidden badges", () => {
  it("excludes hidden + locked badges from the output entirely (counts stay consistent)", () => {
    const badges = computeBadges(
      cfg([
        def({ id: "visible", threshold: 1 }),
        def({ id: "mystery", trigger: "manual", threshold: 0, hidden: true }),
        def({ id: "mystery-auto", threshold: 99, hidden: true }),
      ]),
      ctx,
      []
    );
    expect(badges.map((b) => b.id)).toEqual(["visible"]);
    expect(badges.length).toBe(1);
    expect(badges.filter((b) => b.unlocked).length).toBe(1);
  });

  it("includes hidden badges once unlocked (by award or by stats) with hidden=true", () => {
    const badges = computeBadges(
      cfg([
        def({ id: "mystery", trigger: "manual", threshold: 0, hidden: true }),
        def({ id: "mystery-auto", threshold: 1, hidden: true }),
        def({ id: "plain", threshold: 1 }),
      ]),
      ctx,
      [award({ badgeId: "mystery", source: "MANUAL" })]
    );
    expect(badges.map((b) => b.id)).toEqual(["mystery", "mystery-auto", "plain"]);
    expect(badges[0]!.hidden).toBe(true);
    expect(badges[1]!.hidden).toBe(true);
    expect(badges[2]!.hidden).toBe(false);
  });
});

describe("computeGamificationData", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  const baseParams = {
    dashboard: { courses: 2, slides: [] } as never,
    activities: [],
    attendance: null,
    instituteId: "inst-1",
  };

  it("emits no badges when the master toggle is off, and leaves caching to the dashboard", () => {
    const data = computeGamificationData({
      ...baseParams,
      badgeConfig: { version: 1, enabled: false, badges: [def({ id: "one" })] },
    });
    expect(data.badgesEnabled).toBe(false);
    expect(data.badges).toEqual([]);
    // Compute no longer writes the cache: the dashboard writes it after the
    // server-points overlay, so other pages never read a stale local total.
    expect(getCachedGamification("inst-1")).toBeNull();
  });

  it("leaves XP untouched by badges (no badge points)", () => {
    const withoutAward = computeGamificationData({
      ...baseParams,
      badgeConfig: cfg([def({ id: "m", trigger: "manual", threshold: 0 })]),
      awardedBadges: [],
    });
    const withAward = computeGamificationData({
      ...baseParams,
      badgeConfig: cfg([def({ id: "m", trigger: "manual", threshold: 0 })]),
      awardedBadges: [award({ badgeId: "m", source: "MANUAL" })],
    });
    expect(withAward.totalXp).toBe(withoutAward.totalXp);
    expect(withAward.level).toBe(withoutAward.level);
    expect(withAward.badges[0]!.unlocked).toBe(true);
    expect(withoutAward.badges[0]!.unlocked).toBe(false);
  });
});

describe("celebration helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  const snap = (badges: Array<Partial<PlayBadge> & { id: string }>, enabled = true): PlayGamificationData => ({
    currentStreak: 0,
    longestStreak: 0,
    lastActivityDate: null,
    weeklyDots: [],
    totalXp: 0,
    todayXp: 0,
    level: 1,
    xpToNextLevel: 500,
    badgesEnabled: enabled,
    badges: badges.map((b) => ({
      name: b.id,
      description: "",
      icon: "Star",
      unlocked: false,
      unlockedAt: null,
      ...b,
    })),
  });

  it("returns nothing on first load (no cached snapshot)", () => {
    expect(findNewlyUnlockedBadges(null, snap([{ id: "a", unlocked: true }]))).toEqual([]);
  });

  it("returns only badges that flipped to unlocked since the previous snapshot", () => {
    const prev = snap([{ id: "a", unlocked: true }, { id: "b", unlocked: false }]);
    const next = snap([{ id: "a", unlocked: true }, { id: "b", unlocked: true }, { id: "c", unlocked: true }]);
    expect(findNewlyUnlockedBadges(prev, next).map((b) => b.id)).toEqual(["b", "c"]);
  });

  it("returns nothing when badges are disabled", () => {
    const prev = snap([{ id: "a", unlocked: false }]);
    expect(findNewlyUnlockedBadges(prev, snap([{ id: "a", unlocked: true }], false))).toEqual([]);
  });

  it("findNewlyUnlockedSince diffs against a baseline of ids; a null baseline is quiet", () => {
    const next = snap([{ id: "a", unlocked: true }, { id: "b", unlocked: true }, { id: "c", unlocked: false }]);
    expect(findNewlyUnlockedSince(null, next)).toEqual([]);
    expect(findNewlyUnlockedSince(new Set(["a"]), next).map((b) => b.id)).toEqual(["b"]);
    expect(findNewlyUnlockedSince(new Set(["a", "b"]), next)).toEqual([]);
  });

  it("the celebration baseline round-trips per institute AND learner, and a partial run never writes it", () => {
    // No baseline yet → first load is quiet.
    expect(readCelebrationBaseline("inst-1", "u1")).toBeNull();

    const complete = snap([{ id: "completionist", unlocked: true }, { id: "streak_7", unlocked: true }]);
    writeCelebrationBaseline("inst-1", "u1", complete);
    expect([...(readCelebrationBaseline("inst-1", "u1") ?? [])].sort()).toEqual(["completionist", "streak_7"]);

    // Another learner on the same device has their own baseline.
    expect(readCelebrationBaseline("inst-1", "u2")).toBeNull();

    // A later complete run that still holds completionist does not report it as new,
    // even though a partial run in between (not written) computed it as locked.
    const partial = snap([{ id: "completionist", unlocked: false }, { id: "streak_7", unlocked: true }]);
    expect(findNewlyUnlockedSince(readCelebrationBaseline("inst-1", "u1"), partial)).toEqual([]);
    expect(findNewlyUnlockedSince(readCelebrationBaseline("inst-1", "u1"), complete)).toEqual([]);
  });

  it("shouldCelebrateBadge fires once per badge id per session", () => {
    expect(shouldCelebrateBadge("a")).toBe(true);
    expect(shouldCelebrateBadge("a")).toBe(false);
    expect(shouldCelebrateBadge("b")).toBe(true);
    expect(shouldCelebrateBadge("")).toBe(false);
  });
});
