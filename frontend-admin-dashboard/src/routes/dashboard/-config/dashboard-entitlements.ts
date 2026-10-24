import type { Entitlement } from '@/lib/capabilities/entitlement';

/**
 * Dashboard pieces the capability catalogue does not list itself
 * (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §4, §9). Widgets, quick actions,
 * assistant groups and setup steps are governed by the catalogue directly; the
 * KPI cards inside the KPI band are not, so they are mapped here to the feature
 * that owns their data. A card listed with several features needs all of them.
 * Unlisted cards (teamMembers) are ungoverned.
 */
export const KPI_FEATURES: Readonly<Record<string, readonly string[]>> = {
    activeLearners: ['lms.batches'],
    totalCourses: ['lms.courses'],
    outstandingFees: ['finance.fees'],
    overdueFees: ['finance.fees'],
    classesToday: ['live_classes.sessions'],
};

export const isKpiEntitled = (kpiId: string, entitlement: Entitlement): boolean =>
    (KPI_FEATURES[kpiId] ?? []).every((f) => entitlement.isFeatureOn(f));

/**
 * The fresh-institute checklist steps the catalogue governs (`setup_steps`).
 * "profile" is ungoverned and always shown.
 */
export const GOVERNED_SETUP_STEP_IDS = ['level', 'course', 'batch', 'learner'] as const;

/**
 * Whether the fresh-institute checklist has anything of the plan to set up. A
 * MANAGED institute without LMS (CRM-only) has none, so it is never treated as
 * "fresh" — it gets the normal dashboard instead of an LMS checklist.
 */
export const hasEntitledSetupStep = (entitlement: Entitlement): boolean =>
    GOVERNED_SETUP_STEP_IDS.some((id) => entitlement.isSetupStepEntitled(id));

/**
 * The welcome line under the header. Its default copy is about learning; a
 * MANAGED institute whose plan has no LMS gets neutral copy. LEGACY (and any
 * plan with courses) keeps the original text.
 */
export const welcomeTextKey = (entitlement: Entitlement): string =>
    entitlement.managed && !entitlement.isFeatureOn('lms.courses')
        ? 'welcomeVideo.textGeneral'
        : 'welcomeVideo.text';
