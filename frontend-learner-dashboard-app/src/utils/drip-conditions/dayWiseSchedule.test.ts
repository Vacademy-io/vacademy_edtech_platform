import { describe, expect, it } from "vitest";
import { evaluateDripCondition } from "./evaluateDripCondition";
import {
  enforceableCondition,
  parseCourseSettingsDripConditions,
  resolveDripCondition,
} from "./resolveDripCondition";
import type { DripConditionJson } from "./types";
import type { StoredDripCondition } from "./resolveDripCondition";

const dayRule = (day: number): DripConditionJson => ({
  target: "chapter",
  behavior: "lock",
  is_enabled: true,
  rules: [
    {
      type: "relative_date",
      params: { unlock_on_day: day, anchor: "enrollment", unlock_time: "00:00" },
    },
  ],
});

/** A learner who enrolled `daysAgo` days back, at 09:00 that morning. */
const enrolledDaysAgo = (daysAgo: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(9, 0, 0, 0);
  return date;
};

describe("day-wise drip schedule", () => {
  it("opens day 1 immediately for a learner who just enrolled", () => {
    const result = evaluateDripCondition(dayRule(1), {
      percentageCompleted: 0,
      itemIndex: 0,
      enrollmentDate: enrolledDaysAgo(0),
    });
    expect(result.isLocked).toBe(false);
  });

  it("keeps day 30 locked on the learner's first day", () => {
    const result = evaluateDripCondition(dayRule(30), {
      percentageCompleted: 0,
      itemIndex: 29,
      enrollmentDate: enrolledDaysAgo(0),
    });
    expect(result.isLocked).toBe(true);
    expect(result.unlockMessage).toMatch(/Unlocks in 29 days/);
  });

  it("opens each day's content once that day arrives", () => {
    const enrollment = enrolledDaysAgo(6);
    // Day 7 = six days after enrollment day.
    expect(
      evaluateDripCondition(dayRule(7), {
        percentageCompleted: 0,
        itemIndex: 6,
        enrollmentDate: enrollment,
      }).isLocked
    ).toBe(false);
    expect(
      evaluateDripCondition(dayRule(8), {
        percentageCompleted: 0,
        itemIndex: 7,
        enrollmentDate: enrollment,
      }).isLocked
    ).toBe(true);
  });

  it("does NOT exempt the first item from a day rule", () => {
    // The index-0 escape hatch exists for progress rules, which would
    // otherwise deadlock. A time rule on item 0 must still be honoured.
    const result = evaluateDripCondition(dayRule(5), {
      percentageCompleted: 0,
      itemIndex: 0,
      enrollmentDate: enrolledDaysAgo(0),
    });
    expect(result.isLocked).toBe(true);
  });

  it("still exempts the first item from a sequential rule", () => {
    const result = evaluateDripCondition(
      {
        target: "chapter",
        behavior: "lock",
        is_enabled: true,
        rules: [
          { type: "sequential", params: { requires_previous: true, threshold: 100 } },
        ],
      },
      { percentageCompleted: 0, itemIndex: 0 }
    );
    expect(result.isLocked).toBe(false);
  });

  it("fails open when the enrollment date is unknown", () => {
    const result = evaluateDripCondition(dayRule(30), {
      percentageCompleted: 0,
      itemIndex: 29,
      enrollmentDate: null,
    });
    expect(result.isLocked).toBe(false);
  });

  it("hides instead of locking when the behavior says so", () => {
    const result = evaluateDripCondition(
      { ...dayRule(30), behavior: "hide" },
      {
        percentageCompleted: 0,
        itemIndex: 29,
        enrollmentDate: enrolledDaysAgo(0),
      }
    );
    expect(result.isHidden).toBe(true);
    expect(result.isLocked).toBe(false);
  });
});

describe("resolveDripCondition", () => {
  const conditions: StoredDripCondition[] = [
    {
      id: "a",
      level: "module",
      level_id: "mod-1",
      enabled: true,
      drip_condition: [dayRule(3)],
    },
    {
      id: "b",
      level: "package",
      level_id: "course-1",
      enabled: true,
      drip_condition: [
        { ...dayRule(10), target: "chapter" },
        { ...dayRule(20), target: "subject" },
      ],
    },
  ];

  it("prefers the item's own rule", () => {
    const resolved = resolveDripCondition(conditions, {
      level: "module",
      levelId: "mod-1",
      packageId: "course-1",
    });
    expect(resolved?.rules[0]?.params).toMatchObject({ unlock_on_day: 3 });
  });

  it("falls back to the course rule that targets this level", () => {
    const resolved = resolveDripCondition(conditions, {
      level: "chapter",
      levelId: "ch-9",
      packageId: "course-1",
    });
    expect(resolved?.rules[0]?.params).toMatchObject({ unlock_on_day: 10 });
  });

  it("does not apply a course rule aimed at another level", () => {
    const resolved = resolveDripCondition(conditions, {
      level: "slide",
      levelId: "slide-1",
      packageId: "course-1",
    });
    expect(resolved).toBeNull();
  });

  it("ignores a course rule from a different course", () => {
    const resolved = resolveDripCondition(conditions, {
      level: "chapter",
      levelId: "ch-9",
      packageId: "course-2",
    });
    expect(resolved).toBeNull();
  });
});

describe("opt-in gate", () => {
  const blob = (drip: Record<string, unknown>) =>
    JSON.stringify({ setting: { COURSE_SETTING: { data: { dripConditions: drip } } } });

  const sequential = {
    type: "sequential" as const,
    params: { requires_previous: true, threshold: 100 },
  };
  const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const dateRule = (unlockDate: string): DripConditionJson => ({
    target: "slide",
    behavior: "lock",
    is_enabled: true,
    rules: [{ type: "date_based", params: { unlock_date: unlockDate } }],
  });

  it("enforces a fixed-date rule without the opt-in", () => {
    // The reported bug: an admin set "unlock on the 19th" on a slide, the
    // institute had never flipped the enforce toggle, and the slide stayed
    // open. Time rules cannot harm anyone mid-course, so they never needed
    // the gate.
    expect(enforceableCondition(dateRule(tomorrow()), false)).not.toBeNull();
  });

  it("enforces a day-wise rule without the opt-in", () => {
    expect(enforceableCondition(dayRule(5), false)).not.toBeNull();
  });

  it("still holds a progress-only rule back until the institute opts in", () => {
    const condition: DripConditionJson = {
      target: "chapter",
      behavior: "lock",
      is_enabled: true,
      rules: [sequential],
    };
    expect(enforceableCondition(condition, false)).toBeNull();
    expect(enforceableCondition(condition, true)).toBe(condition);
  });

  it("narrows a mixed rule to its time part until the institute opts in", () => {
    const mixed: DripConditionJson = {
      target: "chapter",
      behavior: "lock",
      is_enabled: true,
      rules: [sequential, dayRule(3).rules[0]!],
    };
    const narrowed = enforceableCondition(mixed, false);
    expect(narrowed?.rules.map((r) => r.type)).toEqual(["relative_date"]);
    expect(enforceableCondition(mixed, true)).toBe(mixed);
  });

  it("a future-dated slide rule locks the slide for an opted-out institute", () => {
    // End to end through resolve + evaluate, the way the slide page runs it.
    const resolved = resolveDripCondition(
      [
        {
          id: "s",
          level: "slide",
          level_id: "slide-1",
          enabled: true,
          drip_condition: [dateRule(tomorrow())],
        },
      ],
      { level: "slide", levelId: "slide-1", packageId: "course-1" },
      { applyConfiguredRules: false }
    );
    expect(resolved).not.toBeNull();
    const result = evaluateDripCondition(resolved, {
      percentageCompleted: 0,
      itemIndex: 1,
    });
    expect(result.isLocked).toBe(true);
    expect(result.unlockMessage).toMatch(/Available from/);
  });

  it("a progress rule resolves to nothing for an opted-out institute", () => {
    const stored = [
      {
        id: "c",
        level: "chapter" as const,
        level_id: "ch-1",
        enabled: true,
        drip_condition: [
          {
            target: "chapter" as const,
            behavior: "lock" as const,
            is_enabled: true,
            rules: [sequential],
          },
        ],
      },
    ];
    const target = { level: "chapter" as const, levelId: "ch-1", packageId: "p" };
    expect(resolveDripCondition(stored, target, { applyConfiguredRules: false })).toBeNull();
    expect(resolveDripCondition(stored, target)).toBeNull();
    expect(resolveDripCondition(stored, target, { applyConfiguredRules: true })).not.toBeNull();
  });

  it("is OFF for an institute that has conditions but never opted in", () => {
    const parsed = parseCourseSettingsDripConditions(
      blob({ enabled: true, conditions: [{ id: "a", level: "chapter", level_id: "c1" }] })
    );
    expect(parsed.enabled).toBe(true);
    expect(parsed.applyConfiguredRules).toBe(false);
    expect(parsed.conditions).toHaveLength(1);
  });

  it("is not inferred from the master switch", () => {
    expect(
      parseCourseSettingsDripConditions(blob({ enabled: true })).applyConfiguredRules
    ).toBe(false);
  });

  it("turns on only when explicitly true", () => {
    expect(
      parseCourseSettingsDripConditions(
        blob({ enabled: true, applyConfiguredRules: true })
      ).applyConfiguredRules
    ).toBe(true);
  });

  it("treats a missing settings blob as fully off", () => {
    const parsed = parseCourseSettingsDripConditions(null);
    expect(parsed.enabled).toBe(false);
    expect(parsed.applyConfiguredRules).toBe(false);
    expect(parsed.conditions).toEqual([]);
  });
});

describe("no leak into the original drip path", () => {
  const blob = (drip: Record<string, unknown>) =>
    JSON.stringify({ setting: { COURSE_SETTING: { data: { dripConditions: drip } } } });

  it("reads the nested blob shape every institute actually stores", () => {
    // All 850 production institutes store { setting: { COURSE_SETTING } }.
    // Reading a flat shape by mistake would report "nothing configured".
    const parsed = parseCourseSettingsDripConditions(
      blob({ enabled: true, applyConfiguredRules: true, conditions: [] })
    );
    expect(parsed.enabled).toBe(true);
    expect(parsed.applyConfiguredRules).toBe(true);
  });

  it("an opted-out institute resolves no condition at all", () => {
    // The gate lives in the hook, but resolve must also be a no-op on the
    // empty condition list an opted-out institute produces.
    expect(resolveDripCondition([], { level: "chapter", levelId: "c", packageId: "p" }))
      .toBeNull();
  });

  it("a rule for another course never leaks across courses", () => {
    expect(
      resolveDripCondition(
        [
          {
            id: "x",
            level: "chapter",
            level_id: "ch-1",
            enabled: true,
            drip_condition: [dayRule(9)],
          },
        ],
        { level: "chapter", levelId: "ch-OTHER", packageId: "p" }
      )
    ).toBeNull();
  });
});

describe("unlocking is computed, not stored", () => {
  it("flips from locked to unlocked purely by the clock moving", () => {
    // Same learner, same rule, same progress — only "now" differs. This is the
    // whole unlock mechanism: no job writes anything, the comparison is just
    // re-run against a later clock.
    const enrollment = enrolledDaysAgo(0);
    const progress = {
      percentageCompleted: 0,
      itemIndex: 1,
      enrollmentDate: enrollment,
    };

    // Day 3 opens at the START of the third calendar day, not 24h x 2 after
    // the enrollment timestamp — that is what "Day 3" means on the schedule.
    const opensAt = new Date(enrollment);
    opensAt.setDate(opensAt.getDate() + 2);
    opensAt.setHours(0, 0, 0, 0);

    const oneMinuteBefore = new Date(opensAt.getTime() - 60 * 1000);

    expect(evaluateDripCondition(dayRule(3), progress, oneMinuteBefore).isLocked).toBe(true);
    expect(evaluateDripCondition(dayRule(3), progress, opensAt).isLocked).toBe(false);
  });

  it("opens at the configured time of day, not at midnight", () => {
    const enrollment = enrolledDaysAgo(0);
    const rule = {
      target: "chapter" as const,
      behavior: "lock" as const,
      is_enabled: true,
      rules: [
        {
          type: "relative_date" as const,
          params: { unlock_on_day: 2, anchor: "enrollment" as const, unlock_time: "09:00" },
        },
      ],
    };
    const progress = {
      percentageCompleted: 0,
      itemIndex: 1,
      enrollmentDate: enrollment,
    };

    const dayTwo = new Date(enrollment);
    dayTwo.setDate(dayTwo.getDate() + 1);

    const justAfterMidnight = new Date(dayTwo);
    justAfterMidnight.setHours(0, 30, 0, 0);
    const nineAm = new Date(dayTwo);
    nineAm.setHours(9, 0, 0, 0);

    expect(evaluateDripCondition(rule, progress, justAfterMidnight).isLocked).toBe(true);
    expect(evaluateDripCondition(rule, progress, nineAm).isLocked).toBe(false);
  });
});
