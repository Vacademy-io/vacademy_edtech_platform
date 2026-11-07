import {
  evaluateDripCondition,
  type DripConditionEvaluation,
} from "./evaluateDripCondition";
import type {
  DripConditionJson,
  DripConditionLevel,
  DripConditionTarget,
} from "./types";

type ContentLevel = Exclude<DripConditionLevel, "package">;

/** Everything outside the list that decides whether one of its items is open. */
export interface ListedItemDripRules {
  /** The admin-configured condition for this item, already narrowed to what the institute enforces. */
  conditionFor: (
    level: ContentLevel,
    levelId: string | null | undefined,
  ) => DripConditionJson | null;
  /** Course-wide condition from the older row-level path, for this level. */
  courseCondition?: DripConditionJson | null;
  /** The older path's own switch. It never governs a configured condition. */
  rowLevelEnabled: boolean;
  enrollmentDate?: string | null;
  sessionStartDate?: string | null;
  now: Date;
}

/** One item of a list, in list order. */
export interface ListedItem {
  id: string;
  percentage: number;
  /** The row's own `drip_condition`, as a JSON string or parsed. */
  rowCondition?: unknown;
}

const OPEN: DripConditionEvaluation = {
  isLocked: false,
  isHidden: false,
  unlockMessage: null,
};

/** The enabled condition stamped on a row for this level, if any. */
export function rowDripCondition(
  raw: unknown,
  level: DripConditionTarget,
): DripConditionJson | null {
  if (!raw) return null;
  const applies = (cond: DripConditionJson) =>
    (cond.target === level || !cond.target) && cond.is_enabled !== false;
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return (parsed as DripConditionJson[]).find(applies) ?? null;
    }
    if (parsed && typeof parsed === "object") {
      const single = parsed as DripConditionJson;
      return applies(single) ? single : null;
    }
  } catch (e) {
    console.error("Failed to parse drip condition:", e);
  }
  return null;
}

/**
 * Whether one item of a list is open to this learner. An item's position decides
 * its progress rules, so this takes the whole list.
 *
 * The configured condition wins, then the row's own, then the course-wide one.
 * Subjects and modules exist only on the configured path.
 */
export function evaluateListedItem(
  level: ContentLevel,
  items: readonly ListedItem[],
  index: number,
  rules: ListedItemDripRules,
  extraCompletions: Record<string, number> = {},
): DripConditionEvaluation {
  const item = items[index];
  if (!item) return OPEN;

  const configured = rules.conditionFor(level, item.id);
  const legacy =
    level === "chapter" || level === "slide"
      ? rowDripCondition(item.rowCondition, level) ??
        rules.courseCondition ??
        null
      : null;
  const condition = configured ?? legacy;
  const applies =
    (rules.rowLevelEnabled || Boolean(configured)) &&
    condition?.is_enabled !== false;
  if (!condition || !applies) return OPEN;

  const previous = index > 0 ? items[index - 1] : undefined;
  const prerequisiteCompletions: Record<string, number> = { ...extraCompletions };
  items.forEach((other) => {
    prerequisiteCompletions[other.id] = other.percentage;
  });

  return evaluateDripCondition(
    condition,
    {
      percentageCompleted: item.percentage,
      previousItemId: previous?.id,
      previousItemCompletion: previous?.percentage ?? 0,
      itemIndex: index,
      prerequisiteCompletions,
      recentScores: items.slice(0, index).map((other) => other.percentage),
      enrollmentDate: rules.enrollmentDate,
      sessionStartDate: rules.sessionStartDate,
    },
    rules.now,
  );
}
