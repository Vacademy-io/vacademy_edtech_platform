import { useEffect, useMemo, useState } from "react";
import { useDripConditionStore } from "@/stores/study-library/drip-conditions-store";
import { getInstituteId } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import {
  fetchEnrollmentAnchor,
  readInstituteDripSettings,
  refreshInstituteDripSettings,
} from "@/services/drip-schedule";
import { useDripClock } from "@/hooks/use-drip-clock";
import {
  enforceableCondition,
  resolveDripCondition,
  type DripConditionJson,
  type DripConditionLevel,
} from "@/utils/drip-conditions";

type ContentLevel = Exclude<DripConditionLevel, "package">;

export interface CourseDripSchedule {
  /** Institute master switch — nothing locks when this is off. */
  enabled: boolean;
  /**
   * Whether this institute has opted into enforcing PROGRESS rules stored in
   * its course settings. Off by default; see ResolvedDripConditions. Time
   * rules (fixed date, day-wise) are enforced regardless.
   */
  applyConfiguredRules: boolean;
  /** Day 1 for `relative_date` rules anchored to the learner's own enrollment. */
  enrollmentDate: string | null;
  /** Day 1 for rules anchored to the batch instead of the individual. */
  sessionStartDate: string | null;
  /**
   * The moment evaluations should treat as "now". Advances once a minute while
   * this course has a time-based rule pending, so locked cards open by
   * themselves instead of waiting for a page refresh.
   */
  now: number;
  /** The condition governing one subject / module / chapter / slide, if any. */
  conditionFor: (
    level: ContentLevel,
    levelId: string | null | undefined,
  ) => DripConditionJson | null;
}

/**
 * Everything the learner side needs to decide what is locked in one course.
 *
 * Conditions come from the institute's COURSE_SETTING blob — that is where the
 * admin dashboard writes them — and the enrollment anchor from the learner's
 * own batch mapping. Both are cached in the persisted drip store so a slow or
 * failed refresh keeps showing the schedule the learner saw a moment ago.
 */
export function useCourseDripSchedule(
  courseId: string | null | undefined,
  packageSessionId: string | null | undefined,
): CourseDripSchedule {
  const conditions = useDripConditionStore((state) => state.conditions);
  // Deliberately NOT isDrippingEnable — see dripSettingsEnabled in the store.
  const enabled = useDripConditionStore((state) => state.dripSettingsEnabled);
  const applyConfiguredRules = useDripConditionStore(
    (state) => state.applyConfiguredRules,
  );
  const enrollmentDates = useDripConditionStore((state) => state.enrollmentDates);
  const setConditions = useDripConditionStore((state) => state.setConditions);
  const setDripSettingsEnabled = useDripConditionStore(
    (state) => state.setDripSettingsEnabled,
  );
  const setEnrollmentDate = useDripConditionStore(
    (state) => state.setEnrollmentDate,
  );
  const setApplyConfiguredRules = useDripConditionStore(
    (state) => state.setApplyConfiguredRules,
  );

  const [sessionStartDate, setSessionStartDate] = useState<string | null>(null);

  // Read the cached settings first so the page paints with the schedule the
  // learner already had, then refresh from the server if that copy has aged
  // out — the blob is otherwise only rewritten at login.
  useEffect(() => {
    let cancelled = false;
    const apply = (settings: {
      enabled: boolean;
      applyConfiguredRules: boolean;
      conditions: typeof conditions;
    }) => {
      if (cancelled) return;
      setDripSettingsEnabled(settings.enabled);
      setApplyConfiguredRules(settings.applyConfiguredRules);
      setConditions(settings.conditions);
    };
    (async () => {
      apply(await readInstituteDripSettings());
      const refreshed = await refreshInstituteDripSettings();
      if (refreshed) apply(refreshed);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setConditions, setDripSettingsEnabled, setApplyConfiguredRules]);

  const cachedEnrollmentDate = packageSessionId
    ? (enrollmentDates[packageSessionId] ?? null)
    : null;

  const ruleTypesPresent = useMemo(() => {
    const types = new Set<string>();
    if (!enabled) return types;
    conditions.forEach((condition) => {
      const configs = Array.isArray(condition.drip_condition)
        ? condition.drip_condition
        : [condition.drip_condition];
      configs.forEach((config) =>
        enforceableCondition(config, applyConfiguredRules)?.rules.forEach(
          (rule) => types.add(rule.type),
        ),
      );
    });
    return types;
  }, [enabled, applyConfiguredRules, conditions]);

  // Only fetched when a day-wise rule could actually need it, and only once per
  // batch — the enrollment date does not move.
  const needsAnchor = ruleTypesPresent.has("relative_date");

  // Time rules are the only ones that can pass without the learner doing
  // anything, so they are the only reason to keep a clock running.
  const now = useDripClock(
    ruleTypesPresent.has("relative_date") || ruleTypesPresent.has("date_based"),
  );

  useEffect(() => {
    if (!needsAnchor || !packageSessionId) return;
    if (cachedEnrollmentDate && sessionStartDate) return;

    let cancelled = false;
    (async () => {
      const instituteId = await getInstituteId();
      if (!instituteId || cancelled) return;
      const anchor = await fetchEnrollmentAnchor(instituteId, packageSessionId);
      if (cancelled) return;
      if (anchor.enrollmentDate) {
        setEnrollmentDate(packageSessionId, anchor.enrollmentDate);
      }
      setSessionStartDate(anchor.sessionStartDate);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    needsAnchor,
    packageSessionId,
    cachedEnrollmentDate,
    sessionStartDate,
    setEnrollmentDate,
  ]);

  return useMemo(
    () => ({
      enabled,
      applyConfiguredRules,
      now,
      enrollmentDate: cachedEnrollmentDate,
      sessionStartDate,
      // The institute switch is the only gate on time rules: a date or
      // day-wise rule the admin saved locks as soon as it is saved. Progress
      // rules additionally need the per-institute opt-in — resolveDripCondition
      // narrows each condition to what this institute enforces.
      conditionFor: (level, levelId) =>
        enabled
          ? resolveDripCondition(
              conditions,
              { level, levelId, packageId: courseId },
              { applyConfiguredRules },
            )
          : null,
    }),
    [
      enabled,
      applyConfiguredRules,
      now,
      cachedEnrollmentDate,
      sessionStartDate,
      conditions,
      courseId,
    ],
  );
}
