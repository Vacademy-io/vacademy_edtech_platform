import {
    ClipboardText,
    MagnifyingGlass,
    Megaphone,
    Money,
    Question,
    UsersThree,
    VideoCamera,
    type Icon,
} from '@phosphor-icons/react';
import type { Entitlement } from '@/lib/capabilities/entitlement';
import type { AssistantCapabilities } from './types';

export interface LaunchBarStarter {
    /** i18n key under `assistant.starters`. */
    key: string;
    /** Assistant tool group the starter needs. */
    group: string;
    /** The tool the starter's prompt actually exercises. */
    tool: string;
    Icon: Icon;
}

/**
 * Ordered by everyday dashboard tasks, not the API's group ordering. Each
 * suggestion requires its actual tool: a read-only group can never suggest a write.
 */
export const STARTERS: readonly LaunchBarStarter[] = [
    { key: 'overview', group: 'institute_overview', tool: 'get_institute_overview', Icon: Money },
    { key: 'learner', group: 'learner_data', tool: 'find_learner', Icon: MagnifyingGlass },
    {
        key: 'assessments',
        group: 'assessments',
        tool: 'get_assessment_results',
        Icon: ClipboardText,
    },
    { key: 'announcement', group: 'announcements', tool: 'send_announcement', Icon: Megaphone },
    { key: 'schedule', group: 'schedule', tool: 'get_class_schedule', Icon: VideoCamera },
    { key: 'payments', group: 'payments', tool: 'get_fee_dues', Icon: Money },
    { key: 'batch', group: 'batch_data', tool: 'list_batch_learners', Icon: UsersThree },
    { key: 'help', group: 'search_help_knowledge', tool: 'search_help_knowledge', Icon: Question },
];

/**
 * Plan features each starter's PROMPT needs, on top of whatever the catalogue
 * says about its assistant group (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §9). A
 * group can be generic while the chip is not: "Check pending fees" runs on the
 * generic institute_overview group but only makes sense with fees. Several
 * features = all must be on. Unlisted starters rely on the group alone.
 */
export const STARTER_FEATURES: Readonly<Record<string, readonly string[]>> = {
    // get_institute_overview(sections=['outstanding_fees'])
    overview: ['finance.fees'],
    // find_learner searches ENROLLED learners only (never leads/contacts)
    learner: ['lms.batches'],
    // get_assessment_results — "pending evaluations"
    assessments: ['assessments.tests'],
    // send_announcement — the tool also targets roles/users, so batches are not required
    announcement: ['communications.announcements'],
    // get_class_schedule — "today's classes"
    schedule: ['live_classes.sessions'],
    // get_fee_dues — a learner's overdue installments
    payments: ['finance.fees'],
    // list_batch_learners
    batch: ['lms.batches'],
};

/**
 * Starters whose example prompt is about a module: when that feature is off the
 * chip stays (the tool is generic) but uses the neutral prompt key instead.
 */
export const STARTER_PROMPT_FALLBACKS: Readonly<
    Record<string, { feature: string; promptKey: string }>
> = {
    // "How do I create a course?" → a core task every plan has
    help: { feature: 'lms.courses', promptKey: 'promptGeneral' },
};

export const MAX_STARTERS = 4;

export const isStarterEntitled = (starter: LaunchBarStarter, entitlement: Entitlement) =>
    entitlement.isAssistantGroupEntitled(starter.group) &&
    (STARTER_FEATURES[starter.key] ?? []).every((f) => entitlement.isFeatureOn(f));

/**
 * The chips to show: plan filter first (MANAGED only), so the slots go to chips
 * the institute can actually use, then the caller's tool access; at most four,
 * backfilled in STARTERS order from whatever remains entitled.
 */
export function pickStarters(
    capabilities: AssistantCapabilities | undefined,
    entitlement: Entitlement,
    max = MAX_STARTERS
): LaunchBarStarter[] {
    const groups = capabilities?.groups ?? [];
    return STARTERS.filter(
        (starter) =>
            isStarterEntitled(starter, entitlement) &&
            groups.some((g) => g.key === starter.group && g.tools.includes(starter.tool))
    ).slice(0, max);
}

/** i18n key of the starter's prompt for this plan. */
export function starterPromptKey(key: string, entitlement: Entitlement): string {
    const fallback = STARTER_PROMPT_FALLBACKS[key];
    const leaf =
        fallback && !entitlement.isFeatureOn(fallback.feature) ? fallback.promptKey : 'prompt';
    return `assistant.starters.${key}.${leaf}`;
}
