export interface CourseInformation {
    descriptionRequired: boolean;
    popularTopicsEnabled: boolean;
    learnerOutcomesRequired: boolean;
    aboutCourseRequired: boolean;
    targetAudienceRequired: boolean;
    previewImageRequired: boolean;
    bannerImageEnabled: boolean;
    bannerImageRequired: boolean;
    courseMediaEnabled: boolean;
    /**
     * Show "Page template content" (and its headings / button text) in Add / Edit Course →
     * Course page. Only institutes whose website has a custom HTML course page template
     * need it. Optional and treated as `false` when missing, so it stays hidden for every
     * institute that has not switched it on.
     */
    coursePageTemplateEnabled?: boolean;
}

export interface CourseStructure {
    defaultDepth: number;
    fixCourseDepth: boolean;
    enableSessions: boolean;
    enableLevels: boolean;
}

/**
 * Step-by-step filter picker shown to learners the first time they open the
 * course catalogue (Level → Session → Tag, in that fixed order). `steps`
 * controls which of those are asked at all; a single-entry array means the
 * learner sees just that one step. Labels are never stored here — the
 * learner app renders each step's title via Naming Settings
 * (ContentTerms.Level / Session / PopularTag) so a renamed term (e.g.
 * "Level" → "Class") stays in sync everywhere automatically.
 */
export interface CatalogueFilterWizardSettings {
    enabled: boolean;
    steps: Array<'level' | 'session' | 'tag'>;
    /** When false, the learner can skip the wizard and browse unfiltered. */
    mandatory: boolean;
}

export interface CatalogueSettings {
    catalogueMode: 'ask' | 'auto' | 'manual';
    autoPublishToCatalogue: boolean;
    filterWizard?: CatalogueFilterWizardSettings;
}

export interface CourseViewSettings {
    defaultViewMode: 'outline' | 'structure';
    /**
     * Show the author-entered description under a module / chapter title on the
     * content cards — Course Details → Content Structure for admins, and the
     * module / chapter cards in the learner app.
     *
     * Optional + treated as `true` when missing so institutes that saved course
     * settings before this field existed keep showing descriptions.
     */
    showContentDescriptions?: boolean;
}

export interface OutlineSettings {
    defaultState: 'expanded' | 'collapsed';
}

export interface Permissions {
    /**
     * Default course filter for Explore Courses:
     * - 'PARENTS_ONLY'   → only parent batches
     * - 'CHILDREN_ONLY'  → only child batches
     * - null / undefined → no default filter (show all)
     */
    courseFilterType?: 'PARENTS_ONLY' | 'CHILDREN_ONLY' | null;
    allowLearnersToCreateCourses: boolean;
    allowPaymentOptionChange: boolean;
    allowDiscountOptionChange: boolean;
    allowReferralOptionChange: boolean;
}

// Drip Conditions Types
export type DripConditionLevel = 'package' | 'subject' | 'module' | 'chapter' | 'slide';
/** Content levels a condition can be attached to (everything below the course). */
export type DripConditionContentLevel = Exclude<DripConditionLevel, 'package'>;
export type DripConditionBehavior = 'lock' | 'hide' | 'both';
export type DripConditionRuleType =
    | 'date_based'
    | 'relative_date'
    | 'completion_based'
    | 'prerequisite'
    | 'sequential';
export type DripConditionMetric = 'average_of_last_n' | 'average_of_all';
/** What a day-wise rule counts day 1 from. */
export type DripAnchor = 'enrollment' | 'session_start';

export interface DateBasedParams {
    unlock_date: string; // ISO 8601 format
}

/**
 * Day-wise unlocking, counted per learner rather than on the calendar.
 *
 * A "30-day course, one chapter a day" schedule cannot use fixed dates: every
 * learner enrols on a different day, so day 7 has to mean their day 7.
 */
export interface RelativeDateParams {
    /** 1-based day of access. Day 1 is the anchor day itself (open immediately). */
    unlock_on_day: number;
    /** Which day counts as day 1. Defaults to the learner's own enrollment. */
    anchor?: DripAnchor;
    /** Local time-of-day it opens, "HH:mm". Defaults to midnight. */
    unlock_time?: string;
}

export interface CompletionBasedParams {
    metric: DripConditionMetric;
    count?: number; // Required for average_of_last_n
    threshold: number; // 0-100
}

export interface PrerequisiteParams {
    required_chapters?: string[];
    required_slides?: string[];
    threshold: number; // 0-100
}

export interface SequentialParams {
    requires_previous: boolean;
    threshold: number; // 0-100
}

export type DripConditionRuleParams =
    | DateBasedParams
    | RelativeDateParams
    | CompletionBasedParams
    | PrerequisiteParams
    | SequentialParams;

export interface DripConditionRule {
    type: DripConditionRuleType;
    params: DripConditionRuleParams;
}

export interface DripConditionConfig {
    target: DripConditionContentLevel; // Required for all levels
    behavior: DripConditionBehavior;
    is_enabled: boolean;
    rules: DripConditionRule[];
}

// DripConditionJson is now an array of configs to support multiple targets per level
export type DripConditionJson = DripConditionConfig[];

export interface DripCondition {
    id: string; // Unique identifier for UI management
    level: DripConditionLevel;
    level_id: string; // packageId, chapterId, or slideId
    drip_condition: DripConditionJson;
    enabled: boolean;
    created_at?: string;
    updated_at?: string;
}

/**
 * What the "Schedule day-wise unlock" generator starts from.
 *
 * Kept in institute settings so an admin sets the house rule once ("modules,
 * one a day, hidden until their day") and every course they schedule after
 * that opens with it pre-filled.
 */
export interface DripScheduleDefaults {
    /** Which level the generator drips: subject, module, chapter or slide. */
    level: DripConditionContentLevel;
    /** Day the FIRST item unlocks on. 1 = available immediately. */
    startDay: number;
    /** Days between one item unlocking and the next. */
    intervalDays: number;
    /** Whether not-yet-due content shows locked or is hidden entirely. */
    behavior: DripConditionBehavior;
    /** What day 1 counts from. */
    anchor: DripAnchor;
    /** Local time-of-day content opens on its day, "HH:mm". */
    unlockTime: string;
}

export interface DripConditionsSettings {
    enabled: boolean; // Global toggle for drip functionality
    conditions: DripCondition[];

    /**
     * Explicit opt-in to ENFORCE the conditions above on learners.
     *
     * MUST default to false and must never be inferred from `enabled`.
     * The admin dashboard wrote conditions into this blob for a long time
     * while the learner app read a different source entirely, so institutes
     * are carrying rules that have never locked anything — 83 across 10
     * institutes as of Aug 2026, nearly all `lock` or `hide`. Turning them on
     * automatically would take content away from learners who have had it
     * open for months, which is why this is a separate, deliberate switch.
     */
    applyConfiguredRules?: boolean;

    /** Optional; falls back to DEFAULT_DRIP_SCHEDULE when absent. */
    scheduleDefaults?: DripScheduleDefaults;
}

/** One item per day, locked (not hidden), counted from the learner's enrollment. */
export const DEFAULT_DRIP_SCHEDULE: DripScheduleDefaults = {
    level: 'chapter',
    startDay: 1,
    intervalDays: 1,
    behavior: 'lock',
    anchor: 'enrollment',
    unlockTime: '00:00',
};

export type OfferPriceRoundingMode = 'NONE' | 'CEIL' | 'FLOOR';

export interface OfferPricingSettings {
    enabled: boolean; // Opt-in toggle for the per-course offer-price tool
    rounding?: OfferPriceRoundingMode; // Whole-unit rounding applied to discounted price; default 'NONE'
}

/**
 * Controls which enrollment-side notification toggles are surfaced in the bulk-assign
 * flow. The toggles default to OFF on the server; these flags only decide whether the
 * admin can see them at all in the dialog.
 */
export interface EnrollmentNotificationsSettings {
    showNotifyLearners: boolean;
    showSendCredentials: boolean;
}

/**
 * Status a slide gets when it is copied via slide "Copy to".
 * - KEEP_DRAFT       → copy is DRAFT (default; matches historical behavior)
 * - INHERIT_SOURCE   → copy keeps the source slide's status (PUBLISHED stays PUBLISHED)
 * - ALWAYS_PUBLISHED → copy is always PUBLISHED
 */
export type CopiedSlideStatus = 'KEEP_DRAFT' | 'INHERIT_SOURCE' | 'ALWAYS_PUBLISHED';

export interface CourseSettingsData {
    courseInformation: CourseInformation;
    courseStructure: CourseStructure;
    catalogueSettings: CatalogueSettings;
    courseViewSettings: CourseViewSettings;
    outlineSettings: OutlineSettings;
    permissions: Permissions;
    dripConditions: DripConditionsSettings;
    offerPricing?: OfferPricingSettings;
    enrollmentNotifications?: EnrollmentNotificationsSettings;
    /**
     * Publish behavior for copied slides. Read by admin_core on slide "Copy to".
     * Optional + defaults to KEEP_DRAFT so existing institutes are unaffected.
     */
    copiedSlideStatus?: CopiedSlideStatus;
}

export interface CourseSettings {
    key: string;
    name: string;
    data: CourseSettingsData;
}

// API Request/Response types
export interface CourseSettingsRequest {
    setting_name: string;
    setting_data: CourseSettingsData;
}

export interface CourseSettingsResponse {
    key: string;
    name: string;
    data: CourseSettingsData;
}

// Default settings
export const DEFAULT_COURSE_SETTINGS: CourseSettingsData = {
    courseInformation: {
        descriptionRequired: true,
        popularTopicsEnabled: true,
        learnerOutcomesRequired: true,
        aboutCourseRequired: true,
        targetAudienceRequired: true,
        previewImageRequired: true,
        bannerImageEnabled: true,
        bannerImageRequired: true,
        courseMediaEnabled: true,
        coursePageTemplateEnabled: false,
    },
    courseStructure: {
        defaultDepth: 3,
        fixCourseDepth: false,
        enableSessions: true,
        enableLevels: true,
    },
    catalogueSettings: {
        catalogueMode: 'ask',
        autoPublishToCatalogue: false,
        filterWizard: {
            enabled: false,
            steps: ['level'],
            mandatory: false,
        },
    },
    courseViewSettings: {
        defaultViewMode: 'outline',
        showContentDescriptions: true,
    },
    outlineSettings: {
        defaultState: 'expanded',
    },
    permissions: {
        courseFilterType: null,
        allowLearnersToCreateCourses: false,
        allowPaymentOptionChange: true,
        allowDiscountOptionChange: true,
        allowReferralOptionChange: true,
    },
    dripConditions: {
        enabled: true,
        conditions: [],
        // Off by default, deliberately — see DripConditionsSettings.
        applyConfiguredRules: false,
        scheduleDefaults: DEFAULT_DRIP_SCHEDULE,
    },
    offerPricing: {
        enabled: false,
        rounding: 'NONE',
    },
    enrollmentNotifications: {
        showNotifyLearners: true,
        showSendCredentials: true,
    },
    copiedSlideStatus: 'KEEP_DRAFT',
};
