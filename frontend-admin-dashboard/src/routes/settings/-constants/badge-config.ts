/**
 * Admin-configurable badge system (admin side).
 *
 * Badges are authored here per-institute and persisted under the institute
 * setting key {@link BADGES_REWARDS_SETTING_KEY}. The learner dashboard reads
 * the same blob and evaluates unlock state on the client.
 *
 * Keep this schema in lock-step with the learner copy at
 * `frontend-learner-dashboard-app/src/services/badge-config.ts`.
 */

import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const BADGES_REWARDS_SETTING_KEY = 'BADGES_REWARDS_SETTING';

export type BadgeTriggerType =
    /** Never unlocks on its own — only when staff award it to a learner. */
    | 'manual'
    | 'course_count'
    | 'slide_count'
    | 'streak'
    | 'xp_total'
    | 'course_completion'
    | 'assessment_score'
    | 'live_session_count'
    | 'live_session_streak';

export interface BadgeDefinitionConfig {
    id: string;
    name: string;
    description: string;
    icon: string; // one of BADGE_ICON_NAMES, a `lib:` library token, or an uploaded file id
    trigger: BadgeTriggerType;
    /** Unlock threshold for auto triggers; always 0 for `manual`. */
    threshold: number;
    enabled: boolean;
    /**
     * Hidden from learners until they earn it (a "mystery" badge). A UI affordance, not a
     * security boundary — the definition is still downloaded by the learner app. Optional
     * for back-compat; absent = visible. (Named `hidden`, not `secret`: the audit-log
     * redactor masks any key called "secret".)
     */
    hidden?: boolean;
}

/** True for the staff-awarded trigger — the badge has no automatic unlock condition. */
export function isManualTrigger(trigger: string | undefined | null): boolean {
    return trigger === 'manual';
}

/** Points-per-action scoring — how many points each factor is worth. Drives learner XP + leaderboard. */
export interface ScoringConfig {
    activityPerDay: number;
    streakPerDay: number;
    liveClassAttended: number;
    courseCompletion: number;
    assessmentBestScore: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
    activityPerDay: 10,
    streakPerDay: 5,
    liveClassAttended: 20,
    courseCompletion: 100,
    assessmentBestScore: 50,
};

/** Admin-facing metadata for each scoring factor (label + helper text + unit). */
export const SCORING_FIELDS: Array<{
    key: keyof ScoringConfig;
    label: string;
    help: string;
}> = [
    {
        key: 'activityPerDay',
        label: 'Learning activity',
        help: 'Points for each day the learner is active.',
    },
    {
        key: 'streakPerDay',
        label: 'Daily streak',
        help: 'Points for each day of the current learning streak.',
    },
    {
        key: 'liveClassAttended',
        label: 'Live class attended',
        help: 'Points for each live class the learner attends.',
    },
    {
        key: 'courseCompletion',
        // Getters so the institute's Course term is read when rendered, not at import.
        get label() {
            return `${getTerminology(ContentTerms.Course, SystemTerms.Course)} completion`;
        },
        get help() {
            return `Points for finishing a ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} (scaled by completion %).`;
        },
    },
    {
        key: 'assessmentBestScore',
        label: 'Assessment score',
        help: 'Points for assessments (scaled by best score %).',
    },
];

export interface BadgesRewardsConfig {
    version: number;
    /** Master switch for the whole badges + leaderboard feature (defaults to OFF — opt-in). */
    enabled: boolean;
    /** Points-per-action scoring (defaults applied when absent). */
    scoring?: ScoringConfig;
    badges: BadgeDefinitionConfig[];
    /** Show full names on the PUBLIC shareable leaderboard (defaults OFF = anonymized initials). */
    publicShowFullNames?: boolean;
}

/** Curated Phosphor icon names available in both the admin picker and learner renderer. */
export const BADGE_ICON_NAMES = [
    'BookOpen',
    'Fire',
    'Lightning',
    'Star',
    'Trophy',
    'Medal',
    'Crown',
    'Rocket',
    'Target',
    'Heart',
    'Confetti',
    'GraduationCap',
    'Lightbulb',
    'Sparkle',
    'Flag',
    'CheckCircle',
] as const;

/** UI metadata for each trigger type: label, helper text, and the unit shown next to the threshold. */
export interface TriggerMeta {
    label: string;
    help: string;
    unit: string;
    defaultThreshold: number;
}

export const TRIGGER_META: Record<BadgeTriggerType, TriggerMeta> = {
    manual: {
        label: 'Awarded manually by staff',
        help: 'Never unlocks on its own — a teacher or admin awards it to a learner (e.g. Helping Hand, Most Improved). Each learner can hold a badge once; for recurring recognition create dated or tiered variants.',
        unit: '',
        defaultThreshold: 0,
    },
    course_count: {
        label: 'Courses enrolled',
        help: 'Unlocks when the learner is enrolled in at least this many courses.',
        unit: 'courses',
        defaultThreshold: 1,
    },
    slide_count: {
        label: 'Slides available',
        help: 'Unlocks when this many slides are available to the learner.',
        unit: 'slides',
        defaultThreshold: 10,
    },
    streak: {
        label: 'Daily streak',
        help: 'Unlocks at this many consecutive active days.',
        unit: 'days',
        defaultThreshold: 7,
    },
    xp_total: {
        label: 'Total XP earned',
        help: 'Unlocks when total XP reaches this value.',
        unit: 'XP',
        defaultThreshold: 1000,
    },
    course_completion: {
        label: 'Course completion %',
        help: 'Unlocks when any course reaches this completion percentage.',
        unit: '%',
        defaultThreshold: 100,
    },
    assessment_score: {
        label: 'Assessment score %',
        help: 'Unlocks when the best released assessment score reaches this percentage.',
        unit: '%',
        defaultThreshold: 100,
    },
    live_session_count: {
        label: 'Live classes attended',
        help: 'Unlocks after the learner attends this many live classes (in total).',
        unit: 'classes',
        defaultThreshold: 10,
    },
    live_session_streak: {
        label: 'Live class streak (in a row)',
        help: 'Unlocks after the learner attends this many live classes in a row, without missing one.',
        unit: 'classes',
        defaultThreshold: 7,
    },
};

export const TRIGGER_OPTIONS = (Object.keys(TRIGGER_META) as BadgeTriggerType[]).map((value) => ({
    value,
    label: TRIGGER_META[value].label,
}));

/**
 * Meta for an unknown trigger value (a badge saved by a newer client, or a typo in the
 * blob). Renders as a manual-style badge instead of crashing on `meta.unit`.
 */
export const FALLBACK_TRIGGER_META: TriggerMeta = {
    label: 'Custom condition',
    help: 'This unlock condition is not recognised by this version of the dashboard.',
    unit: '',
    defaultThreshold: 0,
};

/** Safe lookup — never returns undefined. */
export function getTriggerMeta(trigger: string | undefined | null): TriggerMeta {
    const known = trigger ? (TRIGGER_META as Record<string, TriggerMeta>)[trigger] : undefined;
    return known ?? FALLBACK_TRIGGER_META;
}

/** The original hardcoded six badges, expressed as editable defaults. */
export const DEFAULT_BADGE_CONFIG: BadgesRewardsConfig = {
    version: 1,
    enabled: false,
    scoring: DEFAULT_SCORING,
    badges: [
        {
            id: 'first_course',
            name: 'First Steps',
            description: 'Enrol in your first course',
            icon: 'lib:first_steps-bronze',
            trigger: 'course_count',
            threshold: 1,
            enabled: true,
        },
        {
            id: 'streak_7',
            name: 'On Fire',
            description: 'Maintain a 7-day streak',
            icon: 'lib:streak-silver',
            trigger: 'streak',
            threshold: 7,
            enabled: true,
        },
        {
            id: 'streak_30',
            name: 'Unstoppable',
            description: 'Maintain a 30-day streak',
            icon: 'lib:streak-gold',
            trigger: 'streak',
            threshold: 30,
            enabled: true,
        },
        {
            id: 'perfect_score',
            name: 'Perfect Score',
            description: 'Score 100% on an assessment',
            icon: 'lib:xp_master-gold',
            trigger: 'assessment_score',
            threshold: 100,
            enabled: true,
        },
        {
            id: 'completionist',
            name: 'Completionist',
            description: 'Finish a course at 100%',
            icon: 'lib:completionist-gold',
            trigger: 'course_completion',
            threshold: 100,
            enabled: true,
        },
        {
            id: 'dedicated_learner',
            name: 'Dedicated Learner',
            description: 'Earn 1,000 XP total',
            icon: 'lib:xp_master-diamond',
            trigger: 'xp_total',
            threshold: 1000,
            enabled: true,
        },
    ],
};

/** Generate a stable id for a newly added badge. */
export function newBadgeId(): string {
    try {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            return `badge_${crypto.randomUUID()}`;
        }
    } catch {
        /* fall through */
    }
    return `badge_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function makeNewBadge(trigger: BadgeTriggerType = 'course_count'): BadgeDefinitionConfig {
    if (trigger === 'manual') return makeManualBadge();
    return {
        id: newBadgeId(),
        name: 'New Badge',
        description: '',
        icon: 'lib:first_steps-bronze',
        trigger,
        threshold: TRIGGER_META[trigger].defaultThreshold,
        enabled: true,
    };
}

/**
 * A blank staff-awarded badge. Defaults to a neutral Phosphor icon — every library artwork
 * is themed to an auto trigger (streak, course, XP…), so none fits a recognition badge.
 */
export function makeManualBadge(
    partial: Partial<Omit<BadgeDefinitionConfig, 'trigger' | 'threshold'>> = {}
): BadgeDefinitionConfig {
    return {
        id: partial.id ?? newBadgeId(),
        name: partial.name ?? '',
        description: partial.description ?? '',
        icon: partial.icon ?? 'Star',
        trigger: 'manual',
        threshold: 0,
        enabled: partial.enabled ?? true,
        hidden: partial.hidden ?? false,
    };
}
