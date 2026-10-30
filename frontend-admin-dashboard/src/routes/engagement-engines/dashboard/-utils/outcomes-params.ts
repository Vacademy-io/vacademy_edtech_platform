import type { ReportItemsKind } from '@/services/engagement-daily-report';

/*
 * The lists on the Leads & outcomes page and the `?filter=` values each one understands.
 * Shared by the page itself and by the report's links into it, so the two cannot drift apart.
 */

export const OUTCOME_TABS = ['leads', 'demos', 'status', 'conversions', 'templates'] as const;
export type OutcomeTab = (typeof OUTCOME_TABS)[number];

export const isOutcomeTab = (value: unknown): value is OutcomeTab =>
    typeof value === 'string' && (OUTCOME_TABS as readonly string[]).includes(value);

/** Leads added: new vs already in the CRM. A list is `list:<id>`. */
export const LEAD_FILTERS = ['new', 'existing'] as const;
export const LIST_FILTER_PREFIX = 'list:';

/**
 * Demos: booked on the day (the default) or scheduled for it. The scheduled ones can be
 * narrowed by what happened to them.
 */
export const DEMO_FILTERS = ['booked', 'scheduled', 'done', 'no_show', 'not_marked'] as const;
export type DemoFilter = (typeof DEMO_FILTERS)[number];

/** Status changes: who made them. */
export const STATUS_FILTERS = ['engine', 'team', 'automation'] as const;

/** New WhatsApp templates: by the category the engine proposed, or by where they stand. */
export const TEMPLATE_CATEGORY_FILTERS = ['marketing', 'utility', 'authentication'] as const;
export const TEMPLATE_STATUS_FILTERS = [
    'in_review',
    'approved_by_you',
    'with_meta',
    'live',
    'rejected',
    'withdrawn',
] as const;
/** Proposed as utility, but Meta made it marketing. */
export const TEMPLATE_MOVED_FILTER = 'moved_to_marketing';
export const TEMPLATE_FILTERS: readonly string[] = [
    ...TEMPLATE_CATEGORY_FILTERS,
    ...TEMPLATE_STATUS_FILTERS,
    TEMPLATE_MOVED_FILTER,
];

export const listFilter = (listId: string): string => `${LIST_FILTER_PREFIX}${listId}`;
export const listIdOf = (filter: string | undefined): string | null =>
    filter?.startsWith(LIST_FILTER_PREFIX) && filter.length > LIST_FILTER_PREFIX.length
        ? filter.slice(LIST_FILTER_PREFIX.length)
        : null;

/** The filter if this tab understands it, else undefined (a stale or foreign value is dropped). */
export const normalizeOutcomeFilter = (
    tab: OutcomeTab,
    filter: string | undefined
): string | undefined => {
    if (!filter) return undefined;
    switch (tab) {
        case 'leads':
            return (LEAD_FILTERS as readonly string[]).includes(filter) || listIdOf(filter)
                ? filter
                : undefined;
        case 'demos':
            // "Booked" is what the tab shows with no filter.
            return filter !== 'booked' && (DEMO_FILTERS as readonly string[]).includes(filter)
                ? filter
                : undefined;
        case 'status':
            return (STATUS_FILTERS as readonly string[]).includes(filter) ? filter : undefined;
        case 'templates':
            return TEMPLATE_FILTERS.includes(filter) ? filter : undefined;
        default:
            return undefined;
    }
};

/** What to ask the items endpoint for, for one tab and its filter. */
export const itemsQueryFor = (
    tab: OutcomeTab,
    filter: string | undefined
): { kind: ReportItemsKind; filter?: string } => {
    const f = normalizeOutcomeFilter(tab, filter);
    switch (tab) {
        case 'leads':
            return { kind: 'LEADS_ADDED', filter: f };
        case 'demos':
            if (!f) return { kind: 'DEMOS_BOOKED' };
            return { kind: 'DEMOS_SCHEDULED', filter: f === 'scheduled' ? undefined : f };
        case 'status':
            return { kind: 'STATUS_CHANGES', filter: f };
        case 'templates':
            return { kind: 'TEMPLATES_CREATED', filter: f };
        default:
            return { kind: 'CONVERSIONS' };
    }
};
