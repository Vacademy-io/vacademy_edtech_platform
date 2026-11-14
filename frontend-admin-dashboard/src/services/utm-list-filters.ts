import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_UTM_DASHBOARD, GET_UTM_FILTER_OPTIONS } from '@/constants/urls';

/**
 * The dimensions a campaign (UTM) filter can narrow on. `source_type` is the
 * capture surface the tagged link pointed at (audience form, enrol invite, …)
 * — not a UTM parameter, but the same question ("where did they come from")
 * from the other side, so it sits beside the five.
 */
export const UTM_FILTER_DIMENSIONS = [
    'source',
    'medium',
    'campaign',
    'content',
    'term',
    'source_type',
] as const;

export type UtmFilterDimension = (typeof UTM_FILTER_DIMENSIONS)[number];

/**
 * The three every marketer tags. Always offered once campaign filters are on,
 * even before any data exists — a dropdown with nothing in it tells the admin
 * the feature is live and what it will hold; a bar with no dropdowns at all
 * tells them nothing.
 */
export const CORE_UTM_FILTER_DIMENSIONS: readonly UtmFilterDimension[] = [
    'source',
    'medium',
    'campaign',
];

/** Selected values per dimension, as the filter bar holds them. */
export type UtmFilterSelection = Partial<Record<UtmFilterDimension, string[]>>;

/**
 * Wire shape of `utm_filters` on every list request (leads, contacts,
 * students). snake_case — it is the API shape. Absent/empty lists are no
 * filter; `untagged_only` wins over the lists when set.
 */
export interface UtmListFiltersPayload {
    sources?: string[];
    mediums?: string[];
    campaigns?: string[];
    contents?: string[];
    terms?: string[];
    source_types?: string[];
    untagged_only?: boolean;
}

/** Distinct values per dimension (snake_case: the API shape). */
export interface UtmFilterOptions {
    sources: string[];
    mediums: string[];
    campaigns: string[];
    contents: string[];
    terms: string[];
    source_types: string[];
    total_touches: number;
}

export const EMPTY_UTM_FILTER_OPTIONS: UtmFilterOptions = {
    sources: [],
    mediums: [],
    campaigns: [],
    contents: [],
    terms: [],
    source_types: [],
    total_touches: 0,
};

export const utmFilterOptionsQueryKey = (instituteId: string) =>
    ['utm-filter-options', instituteId] as const;

/**
 * Every distinct value each dimension holds for the institute. Resolves to the
 * empty shape on failure: this feeds dropdown option lists on pages that must
 * keep rendering, and "no options yet" is the normal state for an institute
 * that has only just switched campaign links on.
 */
export const fetchUtmFilterOptions = async (instituteId: string): Promise<UtmFilterOptions> => {
    if (!instituteId) return EMPTY_UTM_FILTER_OPTIONS;
    try {
        const { data } = await authenticatedAxiosInstance.get<Partial<UtmFilterOptions>>(
            GET_UTM_FILTER_OPTIONS,
            { params: { instituteId } }
        );
        const list = (v: unknown): string[] =>
            Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
        return {
            sources: list(data?.sources),
            mediums: list(data?.mediums),
            campaigns: list(data?.campaigns),
            contents: list(data?.contents),
            terms: list(data?.terms),
            source_types: list(data?.source_types),
            total_touches: typeof data?.total_touches === 'number' ? data.total_touches : 0,
        };
    } catch {
        return EMPTY_UTM_FILTER_OPTIONS;
    }
};

// ── Dashboard ──────────────────────────────────────────────────────────

export interface UtmDashboardBucket {
    /** null = the touch carried no value for this dimension. */
    key: string | null;
    touches: number;
    people: number;
    enrolled: number;
}

export interface UtmDashboardTrendPoint {
    /** yyyy-MM-dd in the institute's timezone. */
    date: string;
    touches: number;
    people: number;
}

export interface UtmDashboardCampaignRow {
    utm_campaign: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    source_type: string | null;
    touches: number;
    people: number;
    enrolled: number;
    first_seen: string | null;
    last_seen: string | null;
}

export interface UtmDashboard {
    totals: {
        touches: number;
        people: number;
        enrolled: number;
        distinct_sources: number;
        distinct_campaigns: number;
        leads_in_window: number;
        attributed_leads_in_window: number;
    };
    by_source: UtmDashboardBucket[];
    by_medium: UtmDashboardBucket[];
    by_campaign: UtmDashboardBucket[];
    by_content: UtmDashboardBucket[];
    by_term: UtmDashboardBucket[];
    by_source_type: UtmDashboardBucket[];
    trend: UtmDashboardTrendPoint[];
    campaigns: UtmDashboardCampaignRow[];
}

export interface UtmDashboardParams {
    instituteId: string;
    /** yyyy-MM-dd, inclusive, institute timezone. */
    fromDate: string;
    toDate: string;
}

export const utmDashboardQueryKey = (p: UtmDashboardParams) =>
    ['crm-reports', 'utm-dashboard', p.instituteId, p.fromDate, p.toDate] as const;

export const fetchUtmDashboard = async (p: UtmDashboardParams): Promise<UtmDashboard> => {
    const { data } = await authenticatedAxiosInstance.get<UtmDashboard>(GET_UTM_DASHBOARD, {
        params: { instituteId: p.instituteId, fromDate: p.fromDate, toDate: p.toDate },
    });
    return data;
};
