import type {
  DripConditionJson,
  DripConditionLevel,
  DripConditionRuleType,
  DripConditionTarget,
} from "./types";

/**
 * One stored drip condition as the admin dashboard writes it into the
 * institute's COURSE_SETTING blob.
 *
 * `drip_condition` is an array there (one config per targeted level), while a
 * `DripConditionJson` read off a chapter/slide row is a single object. Both
 * shapes flow through here.
 */
export interface StoredDripCondition {
  id: string;
  level: DripConditionLevel;
  level_id: string;
  drip_condition: DripConditionJson | DripConditionJson[];
  enabled?: boolean;
}

export interface ResolvedDripConditions {
  /** Institute-wide master switch (COURSE_SETTING.data.dripConditions.enabled) */
  enabled: boolean;
  /**
   * Explicit opt-in to enforce PROGRESS rules stored in the settings blob.
   *
   * MUST default to false. Those conditions were written by the admin
   * dashboard for a long time while nothing read them, so institutes are
   * carrying prerequisite / completion / sequential rules that have never
   * once locked anything — 70-odd across 10 institutes as of Sep 2026.
   * Honouring them automatically would take content away from learners who
   * have had it open for months. An admin has to turn this on per institute.
   *
   * Time rules (`date_based`, `relative_date`) are NOT behind this flag — see
   * enforceableCondition.
   */
  applyConfiguredRules: boolean;
  conditions: StoredDripCondition[];
}

const EMPTY: ResolvedDripConditions = {
  enabled: false,
  applyConfiguredRules: false,
  conditions: [],
};

/**
 * Pull the drip configuration out of the raw institute-settings JSON.
 *
 * Conditions live in the institute settings rather than on the content rows:
 * that is where the admin dashboard writes them, so it is the only place a
 * learner can read back what an admin actually configured. Per-row
 * `drip_condition_json` is still honoured by callers as a fallback for
 * anything written before this path existed.
 */
export function parseCourseSettingsDripConditions(
  rawSettingsJson: string | null | undefined
): ResolvedDripConditions {
  if (!rawSettingsJson || rawSettingsJson.trim() === "") return EMPTY;

  try {
    const parsed = JSON.parse(rawSettingsJson);
    // Two shapes are in circulation for the cached settings blob: some writers
    // store the whole institute payload ({ setting: { COURSE_SETTING } }),
    // others store just the `setting` value ({ COURSE_SETTING }). Accept both
    // — reading the wrong one silently reports "no drip configured".
    const courseSetting =
      parsed?.setting?.COURSE_SETTING ?? parsed?.COURSE_SETTING ?? null;
    const drip = courseSetting?.data?.dripConditions ?? null;
    if (!drip || typeof drip !== "object") return EMPTY;

    return {
      enabled: drip.enabled === true,
      // `=== true` and not `!== false`: absent means "never opted in".
      applyConfiguredRules: drip.applyConfiguredRules === true,
      conditions: Array.isArray(drip.conditions) ? drip.conditions : [],
    };
  } catch (error) {
    console.error("Error parsing course drip conditions:", error);
    return EMPTY;
  }
}

const configsOf = (
  condition: StoredDripCondition
): DripConditionJson[] => {
  const raw = condition.drip_condition;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
};

const isLive = (config: DripConditionJson): boolean =>
  config.is_enabled !== false &&
  Array.isArray(config.rules) &&
  config.rules.length > 0;

/** Rules the clock alone can satisfy — no learner action involved. */
export const TIME_RULE_TYPES: readonly DripConditionRuleType[] = [
  "date_based",
  "relative_date",
];

/**
 * The part of a saved condition this institute actually enforces.
 *
 * Time rules always apply. Every legacy date rule in production is already in
 * the past (checked Sep 2026), so enforcing them changes nothing for existing
 * learners, and a future-dated one is exactly what the admin just asked for —
 * "unlock on the 19th" saving without locking anything was reported as a bug.
 *
 * Progress rules stay behind `applyConfiguredRules`: those are the dormant
 * legacy rules that would lock content under learners mid-course. Until the
 * institute opts in, a mixed condition is narrowed to its time rules (AND of
 * fewer rules only ever unlocks more), and a progress-only condition is
 * dropped entirely.
 */
export function enforceableCondition(
  condition: DripConditionJson | null | undefined,
  applyConfiguredRules: boolean
): DripConditionJson | null {
  if (!condition) return null;
  if (applyConfiguredRules) return condition;
  const rules = (condition.rules ?? []).filter((rule) =>
    TIME_RULE_TYPES.includes(rule.type)
  );
  if (rules.length === 0) return null;
  return rules.length === condition.rules.length
    ? condition
    : { ...condition, rules };
}

/**
 * The condition that governs one piece of content.
 *
 * An item's own condition wins; otherwise the course-wide condition applies,
 * but only the part of it that targets this level — a package rule set to drip
 * chapters must leave subjects and slides alone.
 *
 * Pass `applyConfiguredRules` to get back only what the institute enforces
 * (see enforceableCondition); it defaults to the opted-out reading.
 */
export function resolveDripCondition(
  conditions: StoredDripCondition[] | null | undefined,
  target: {
    level: Exclude<DripConditionLevel, "package">;
    levelId: string | null | undefined;
    packageId: string | null | undefined;
  },
  options: { applyConfiguredRules?: boolean } = {}
): DripConditionJson | null {
  if (!conditions?.length) return null;
  const { level, levelId, packageId } = target;
  const applyConfiguredRules = options.applyConfiguredRules === true;
  const enforceable = (config: DripConditionJson): DripConditionJson | null =>
    isLive(config) ? enforceableCondition(config, applyConfiguredRules) : null;

  if (levelId) {
    const own = conditions
      .filter(
        (c) => c.level === level && c.level_id === levelId && c.enabled !== false
      )
      .flatMap(configsOf)
      .map(enforceable)
      .find((config) => config !== null);
    if (own) return own;
  }

  if (packageId) {
    const fromPackage = conditions
      .filter(
        (c) =>
          c.level === "package" &&
          c.level_id === packageId &&
          c.enabled !== false
      )
      .flatMap(configsOf)
      .filter((config) => config.target === (level as DripConditionTarget))
      .map(enforceable)
      .find((config) => config !== null);
    if (fromPackage) return fromPackage;
  }

  return null;
}
