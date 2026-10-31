/**
 * Drip Conditions Utilities
 *
 * This module provides utilities for parsing, evaluating, and displaying
 * drip conditions for progressive content unlocking.
 */

export { parseDripCondition, getConditionForLevel } from "./parseDripCondition";
export {
  evaluateDripCondition,
  evaluateMultipleConditions,
  countLockedAndHidden,
} from "./evaluateDripCondition";
export {
  formatUnlockMessage,
  getDripConditionSummary,
  formatBehavior,
} from "./displayHelpers";
export {
  selectDripCondition,
  hasEnabledConditionForTarget,
  getEnabledConditionForTarget,
} from "./selectDripCondition";

export type {
  LearnerProgressData,
  DripConditionEvaluation,
} from "./evaluateDripCondition";

// Re-export types for convenience
export type {
  DripConditionJson,
  DripConditionRule,
  DripConditionLevel,
  DripConditionBehavior,
  DripConditionTarget,
  DripAnchor,
  RelativeDateParams,
} from "./types";

export {
  resolveDripCondition,
  enforceableCondition,
  parseCourseSettingsDripConditions,
  TIME_RULE_TYPES,
} from "./resolveDripCondition";
export type {
  ResolvedDripConditions,
  StoredDripCondition,
} from "./resolveDripCondition";
