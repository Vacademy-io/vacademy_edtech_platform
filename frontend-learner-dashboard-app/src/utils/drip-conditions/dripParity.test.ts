import { describe, expect, it } from "vitest";
import cases from "./__fixtures__/drip_parity_cases.json";
import { evaluateDripCondition } from "./evaluateDripCondition";
import type { LearnerProgressData } from "./evaluateDripCondition";
import { getConditionForLevel, parseDripCondition } from "./parseDripCondition";
import {
  parseCourseSettingsDripConditions,
  resolveDripCondition,
} from "./resolveDripCondition";
import type { DripConditionJson, DripConditionLevel } from "./types";

/**
 * Shared parity cases: the same JSON runs through the Python twin in
 * ai_service/tests/test_course_knowledge_drip_parity.py. A case that fails
 * here or there means the two evaluators have drifted — fix both.
 *
 * Anchors and `now` sit at 12:00 UTC, so results do not depend on the time
 * zone the suite runs in (UTC or IST alike).
 */

interface ExpectedEvaluation {
  is_locked: boolean;
  is_hidden: boolean;
  message?: string | null;
  message_regex?: string;
}

interface EvaluateCase {
  name: string;
  condition: unknown;
  progress: Record<string, unknown>;
  now?: string;
  expected: ExpectedEvaluation;
}

interface ResolveCase {
  name: string;
  settings_json: string;
  target: {
    level: Exclude<DripConditionLevel, "package">;
    levelId: string | null;
    packageId: string | null;
  };
  expected: {
    enabled: boolean;
    apply_configured_rules: boolean;
    condition: unknown;
  };
}

interface LevelSelectCase {
  name: string;
  drip_json: string;
  level: "chapter" | "slide";
  expected: { success: boolean; condition: unknown };
}

const fixtures = cases as unknown as {
  now: string;
  evaluate: EvaluateCase[];
  resolve: ResolveCase[];
  level_select: LevelSelectCase[];
};

describe("drip parity fixtures", () => {
  it("has enough shared cases to mean something", () => {
    expect(
      fixtures.evaluate.length +
        fixtures.resolve.length +
        fixtures.level_select.length,
    ).toBeGreaterThanOrEqual(40);
  });

  describe("evaluateDripCondition", () => {
    for (const c of fixtures.evaluate) {
      it(c.name, () => {
        const result = evaluateDripCondition(
          c.condition as DripConditionJson | null,
          c.progress as unknown as LearnerProgressData,
          new Date(c.now ?? fixtures.now),
        );
        expect(result.isLocked).toBe(c.expected.is_locked);
        expect(result.isHidden).toBe(c.expected.is_hidden);
        if (c.expected.message_regex !== undefined) {
          expect(result.unlockMessage).toMatch(
            new RegExp(c.expected.message_regex),
          );
        } else if (c.expected.message !== undefined) {
          expect(result.unlockMessage).toBe(c.expected.message);
        }
      });
    }
  });

  describe("parseCourseSettingsDripConditions + resolveDripCondition", () => {
    for (const c of fixtures.resolve) {
      it(c.name, () => {
        const settings = parseCourseSettingsDripConditions(c.settings_json);
        expect(settings.enabled).toBe(c.expected.enabled);
        expect(settings.applyConfiguredRules).toBe(
          c.expected.apply_configured_rules,
        );
        const condition = resolveDripCondition(settings.conditions, c.target, {
          applyConfiguredRules: settings.applyConfiguredRules,
        });
        expect(condition).toEqual(c.expected.condition);
      });
    }
  });

  describe("parseDripCondition + getConditionForLevel", () => {
    for (const c of fixtures.level_select) {
      it(c.name, () => {
        const parsed = parseDripCondition(c.drip_json);
        expect(parsed.success).toBe(c.expected.success);
        const condition =
          parsed.success && parsed.data
            ? getConditionForLevel(parsed.data, c.level)
            : null;
        expect(condition).toEqual(c.expected.condition);
      });
    }
  });
});
