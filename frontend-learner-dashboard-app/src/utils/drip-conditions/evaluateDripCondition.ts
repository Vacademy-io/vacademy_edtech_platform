/**
 * A Python twin lives in ai_service/app/services/course_knowledge/drip.py
 * (the student AI uses it to decide which lessons it may quote). Change both,
 * and update the shared fixtures in __fixtures__/drip_parity_cases.json.
 */
import type {
  DripConditionJson,
  DripConditionRule,
  DripConditionRuleType,
  DateBasedParams,
  RelativeDateParams,
  CompletionBasedParams,
  PrerequisiteParams,
  SequentialParams,
} from "./types";
import {
  isDateBasedParams,
  isRelativeDateParams,
  isCompletionBasedParams,
  isPrerequisiteBasedParams,
  isSequentialBasedParams,
} from "./types";

/**
 * Learner progress data for evaluating drip conditions
 */
export interface LearnerProgressData {
  /** Percentage completed for current item (0-100) */
  percentageCompleted: number;
  /**
   * Completion percentages of the items preceding this one, in list order
   * (oldest first, immediately-previous item last). Required by
   * `completion_based` rules — omitting it makes those rules unevaluable.
   */
  recentScores?: number[];
  /** IDs of completed prerequisite chapters/slides */
  completedPrerequisiteIds?: string[];
  /** Percentage completion of prerequisite items (keyed by ID) */
  prerequisiteCompletions?: Record<string, number>;
  /** ID of the previous item in sequence */
  previousItemId?: string;
  /** Percentage completion of the previous item */
  previousItemCompletion?: number;
  /** Zero-based index of current item in the list (for count-based exceptions) */
  itemIndex?: number;
  /**
   * Day 1 of the learner's schedule for `relative_date` rules — normally the
   * date they enrolled in this course. Undefined means "not known yet"; such
   * rules then pass rather than lock, so a failed lookup never walls a learner
   * out of a course they paid for.
   */
  enrollmentDate?: Date | string | null;
  /** Batch/session start date, used by `relative_date` rules anchored to it. */
  sessionStartDate?: Date | string | null;
}

/**
 * Result of drip condition evaluation
 */
export interface DripConditionEvaluation {
  /** Whether content is locked (show with lock icon) */
  isLocked: boolean;
  /** Whether content is hidden (don't show at all) */
  isHidden: boolean;
  /** Human-readable message explaining unlock requirements */
  unlockMessage: string | null;
  /** Detailed reason for lock/hide (for debugging) */
  reason?: string;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The calendar day a `relative_date` rule counts from. Defaults to the
 * learner's enrollment; `session_start` gives every learner in a batch the
 * same schedule instead.
 */
function resolveAnchorDate(
  params: RelativeDateParams,
  progressData: LearnerProgressData
): Date | null {
  if (params.anchor === "session_start") {
    return toDate(progressData.sessionStartDate);
  }
  return toDate(progressData.enrollmentDate);
}

/**
 * Anchor + N days, snapped to the given local time-of-day.
 *
 * Days are counted in local calendar days, not in 24h blocks: a learner who
 * enrolls at 23:50 still gets day 2 ten minutes later rather than a day later,
 * which is what "Day 2" means to everyone reading the schedule.
 */
function addDaysAtTime(
  anchor: Date,
  offsetDays: number,
  unlockTime?: string
): Date {
  const result = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() + offsetDays
  );
  const [hours, minutes] = (unlockTime || "00:00").split(":");
  result.setHours(
    Math.min(23, Math.max(0, Number(hours) || 0)),
    Math.min(59, Math.max(0, Number(minutes) || 0)),
    0,
    0
  );
  return result;
}

/**
 * Evaluate a single drip condition rule
 */
function evaluateRule(
  rule: DripConditionRule,
  progressData: LearnerProgressData,
  currentDate: Date = new Date()
): { passed: boolean; message?: string } {
  const { type, params } = rule;

  switch (type) {
    case "date_based": {
      if (!isDateBasedParams(params)) {
        return { passed: true, message: "Invalid date params" };
      }
      // Parse the unlock date from UTC (as stored in backend)
      const unlockDateUTC = new Date((params as DateBasedParams).unlock_date);

      // Current date is already in user's local timezone
      // Compare directly - JavaScript Date objects handle timezone internally
      const isPassed = currentDate >= unlockDateUTC;

      // Format unlock date in user's local timezone for display
      const unlockDateFormatted = unlockDateUTC.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      return {
        passed: isPassed,
        message: isPassed ? undefined : `Available from ${unlockDateFormatted}`,
      };
    }

    case "relative_date": {
      if (!isRelativeDateParams(params)) {
        return { passed: true, message: "Invalid relative date params" };
      }
      const relativeParams = params as RelativeDateParams;
      const anchorDate = resolveAnchorDate(relativeParams, progressData);

      // No anchor (enrollment date not loaded, or the learner has no
      // enrollment record) — fail open. A drip schedule that cannot be
      // computed must not become a wall.
      if (!anchorDate) {
        return { passed: true };
      }

      const unlockAt = addDaysAtTime(
        anchorDate,
        Math.max(1, Math.round(relativeParams.unlock_on_day || 1)) - 1,
        relativeParams.unlock_time
      );
      const isPassed = currentDate >= unlockAt;
      if (isPassed) {
        return { passed: true };
      }

      const daysLeft = Math.max(
        1,
        Math.ceil((unlockAt.getTime() - currentDate.getTime()) / DAY_IN_MS)
      );
      const unlockDateFormatted = unlockAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return {
        passed: false,
        message: `Unlocks in ${daysLeft} day${
          daysLeft === 1 ? "" : "s"
        } (${unlockDateFormatted})`,
      };
    }

    case "completion_based": {
      if (!isCompletionBasedParams(params)) {
        return { passed: true, message: "Invalid completion params" };
      }
      const completionParams = params as CompletionBasedParams;
      const { metric, threshold, count } = completionParams;

      // Completion percentages of the preceding items, oldest first.
      const scores = progressData.recentScores || [];

      const averageOf = (values: number[]) =>
        values.reduce((sum, score) => sum + score, 0) / values.length;

      if (metric === "average_of_last_n") {
        const requiredCount = count || 1;
        if (scores.length < requiredCount) {
          const missing = requiredCount - scores.length;
          return {
            passed: false,
            message: `Complete ${missing} more slide${
              missing === 1 ? "" : "s"
            }/chapter${missing === 1 ? "" : "s"} to unlock`,
          };
        }
        const average = averageOf(scores.slice(-requiredCount));
        const isPassed = average >= threshold;
        return {
          passed: isPassed,
          message: isPassed
            ? undefined
            : `Score average of ${threshold}% needed (current: ${Math.round(
                average
              )}%)`,
        };
      }

      if (metric === "average_of_all") {
        // Nothing precedes this item, so there is nothing to average against.
        if (scores.length === 0) {
          return { passed: true };
        }
        const average = averageOf(scores);
        const isPassed = average >= threshold;
        return {
          passed: isPassed,
          message: isPassed
            ? undefined
            : `Overall average of ${threshold}% needed (current: ${Math.round(
                average
              )}%)`,
        };
      }

      return { passed: true };
    }

    case "prerequisite": {
      if (!isPrerequisiteBasedParams(params)) {
        return { passed: true, message: "Invalid prerequisite params" };
      }
      const prereqParams = params as PrerequisiteParams;
      const { required_chapters, required_slides, threshold } = prereqParams;

      // Combine required items
      const prerequisiteIds = [
        ...(required_chapters || []),
        ...(required_slides || []),
      ];

      const completedCount = prerequisiteIds.filter((id: string) => {
        const completion = progressData.prerequisiteCompletions?.[id] || 0;
        const isComplete = completion >= threshold;

        return isComplete;
      }).length;

      const isPassed = completedCount === prerequisiteIds.length;
      return {
        passed: isPassed,
        message: isPassed
          ? undefined
          : `Complete ${
              prerequisiteIds.length - completedCount
            } prerequisite(s) with ${threshold}% completion`,
      };
    }

    case "sequential": {
      if (!isSequentialBasedParams(params)) {
        return { passed: true, message: "Invalid sequential params" };
      }
      const seqParams = params as SequentialParams;
      const { threshold } = seqParams;

      const previousCompletion = progressData.previousItemCompletion || 0;
      const isPassed = previousCompletion >= threshold;
      return {
        passed: isPassed,
        message: isPassed
          ? undefined
          : `Complete previous item with ${threshold}% (current: ${previousCompletion}%)`,
      };
    }

    default:
      return { passed: true };
  }
}

/**
 * Rules that depend on the learner having done something first. Only these get
 * the "first item is always open" escape hatch — see evaluateDripCondition.
 */
const PROGRESS_RULE_TYPES: readonly DripConditionRuleType[] = [
  "completion_based",
  "prerequisite",
  "sequential",
];

/**
 * Evaluate drip condition for a specific item
 */
export function evaluateDripCondition(
  condition: DripConditionJson | null,
  progressData: LearnerProgressData,
  currentDate: Date = new Date()
): DripConditionEvaluation {
  // No drip condition = fully accessible
  if (!condition || !condition.rules || condition.rules.length === 0) {
    return {
      isLocked: false,
      isHidden: false,
      unlockMessage: null,
    };
  }

  // Check if condition is disabled via is_enabled flag
  if (condition.is_enabled === false) {
    return {
      isLocked: false,
      isHidden: false,
      unlockMessage: null,
    };
  }

  // EXCEPTION: the first item is always accessible when every rule on it is a
  // PROGRESS rule. Those rules read "finish what came before", and nothing
  // comes before item 0 — without this they deadlock the whole course.
  //
  // Time rules get no such exemption. They cannot deadlock (the clock always
  // advances), and a schedule that silently opened its first item early would
  // be wrong: "Day 5" has to mean day 5 even for the first chapter of a
  // module, and "unlock on the 19th" has to hold for the first slide too.
  // (This used to be opt-in behind strictFirstItem; dropped once no legacy
  // time rule in production was still in the future, Sep 2026.)
  const itemIndex = progressData.itemIndex ?? 0;
  const rulesDeadlockOnFirstItem = condition.rules.every((rule) =>
    PROGRESS_RULE_TYPES.includes(rule.type)
  );
  if (itemIndex === 0 && rulesDeadlockOnFirstItem) {
    return {
      isLocked: false,
      isHidden: false,
      unlockMessage: null,
    };
  }

  // Check for count-based exception: if rule has average_of_last_n with count N,
  // first N items should be accessible (they need to be completed to unlock further items)
  const completionRule = condition.rules.find(
    (r) =>
      r.type === "completion_based" &&
      isCompletionBasedParams(r.params) &&
      (r.params as CompletionBasedParams).metric === "average_of_last_n"
  );

  if (completionRule && isCompletionBasedParams(completionRule.params)) {
    const count = (completionRule.params as CompletionBasedParams).count || 1;

    // First N items are always accessible (needed to calculate average)
    if (itemIndex < count) {
      return {
        isLocked: false,
        isHidden: false,
        unlockMessage: null,
      };
    }
  }

  // Evaluate all rules (AND logic - all must pass)
  const failedRules: string[] = [];
  for (const rule of condition.rules) {
    const result = evaluateRule(rule, progressData, currentDate);
    if (!result.passed && result.message) {
      failedRules.push(result.message);
    }
  }

  // All rules passed = accessible
  if (failedRules.length === 0) {
    return {
      isLocked: false,
      isHidden: false,
      unlockMessage: null,
    };
  }

  // Some rules failed = apply behavior
  const unlockMessage = failedRules.join("; ");
  const { behavior } = condition;

  switch (behavior) {
    case "lock":
      return {
        isLocked: true,
        isHidden: false,
        unlockMessage,
        reason: "Rules not met, content locked",
      };

    case "hide":
      return {
        isLocked: false,
        isHidden: true,
        unlockMessage,
        reason: "Rules not met, content hidden",
      };

    case "both":
      return {
        isLocked: true,
        isHidden: true,
        unlockMessage,
        reason: "Rules not met, content locked and hidden",
      };

    default:
      return {
        isLocked: false,
        isHidden: false,
        unlockMessage: null,
      };
  }
}

/**
 * Evaluate multiple conditions (for batch evaluation)
 */
export function evaluateMultipleConditions(
  condition: DripConditionJson | null,
  progressDataByItemId: Record<string, LearnerProgressData>,
  currentDate: Date = new Date()
): Record<string, DripConditionEvaluation> {
  const results: Record<string, DripConditionEvaluation> = {};

  for (const [itemId, progressData] of Object.entries(progressDataByItemId)) {
    results[itemId] = evaluateDripCondition(
      condition,
      progressData,
      currentDate
    );
  }

  return results;
}

/**
 * Count locked and hidden items
 */
export function countLockedAndHidden(
  evaluations: Record<string, DripConditionEvaluation>
): { locked: number; hidden: number; accessible: number } {
  let locked = 0;
  let hidden = 0;
  let accessible = 0;

  for (const evaluation of Object.values(evaluations)) {
    if (evaluation.isHidden) {
      hidden++;
    } else if (evaluation.isLocked) {
      locked++;
    } else {
      accessible++;
    }
  }

  return { locked, hidden, accessible };
}
