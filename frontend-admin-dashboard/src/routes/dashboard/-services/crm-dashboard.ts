import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

export const CRM_DASHBOARD_URL = `${BASE_URL}/admin-core-service/v1/crm-dashboard`;

export type CrmBlockId =
    | 'summary'
    | 'followups'
    | 'pipeline'
    | 'sources'
    | 'counsellors'
    | 'calls'
    | 'lists'
    | 'quality'
    | 'views'
    | 'list_stats'
    | 'shifts';

export type CrmDuplicateFilter = 'EXCLUDE' | 'ONLY' | 'AUTO';

export interface CrmDashboardRequest {
    institute_id: string;
    from: string;
    to: string;
    timezone: string;
    now: string;
    today_end: string;
    team_id?: string;
    /** One lead list only. */
    audience_id?: string;
    /** Lead status keys to keep / drop (CSV), same as the leads list filter. */
    lead_status_id?: string;
    lead_status_exclude_id?: string;
    /** As the leads list's duplicates=; AUTO = the list's default (Lead Settings → Duplicate Leads only). */
    duplicate_filter?: CrmDuplicateFilter;
    blocks: CrmBlockId[];
}

export interface CrmDailyPoint {
    day: string;
    leads: number;
    /** Of the leads that arrived that day, how many have been contacted. */
    contacted?: number;
    converted: number;
}

export interface CrmSummaryBlock {
    new_leads: number;
    converted: number;
    contacted: number;
    median_first_response_minutes: number | null;
    daily: CrmDailyPoint[];
    previous_new_leads?: number;
    previous_converted?: number;
    previous_daily_leads?: number[];
}

export interface CrmFollowupsBlock {
    overdue: number;
    today: number;
    upcoming: number;
    completed_today?: number;
}

export interface CrmStatusLabel {
    status_key: string;
    label: string | null;
    color: string | null;
    display_order: number | null;
}

export interface CrmPipelineBlock {
    statuses: CrmStatusLabel[];
    counts: Array<{ status_key: string; n: number }>;
}

export interface CrmSourceRow {
    source: string;
    leads: number;
    converted: number;
}

export interface CrmCounsellorRow {
    owner_id: string;
    name: string;
    assigned: number;
    contacted: number;
    converted: number;
    overdue: number;
    median_minutes: number | null;
}

export interface CrmCallsBlock {
    restricted?: boolean;
    total?: number;
    connected?: number;
    talk_seconds?: number;
    ai_calls?: number;
    by_status?: Array<{ status: string; n: number }>;
    heatmap?: Array<{ dow: number; hour: number; n: number }>;
}

export interface CrmListRow {
    audience_id: string;
    name: string | null;
    campaign_type: string | null;
    leads: number;
    contacted: number;
    converted: number;
}

export type CrmAgeBucket = 'TODAY' | 'D1_3' | 'D4_7' | 'D8_14' | 'D15_PLUS';

export interface CrmQualityBlock {
    rows: Array<{ tier: string; age: CrmAgeBucket; n: number }>;
    tiers: Array<{ tier_key: string; label: string | null; color: string | null }>;
}

/** Quick-view counts; each matches a filter the leads list already has. */
export interface CrmViewsBlock {
    all_leads: number;
    active: number;
    converted: number;
    unassigned: number;
    new_today: number;
    followup_overdue: number;
}

/** Lead List card numbers per list (all-time, inside the caller's scope). */
export interface CrmListStatsRow {
    audience_id: string;
    leads: number;
    new_today: number;
    unassigned: number;
    converted: number;
    overdue: number;
    /** Leads per day, oldest first, last 14 days. */
    daily: number[];
}

/** Counsellor pool shifts for today (weekday in the caller's zone). */
export interface CrmShiftsBlock {
    day: string;
    rows: Array<{
        user_id: string;
        pool_id: string;
        pool_name: string | null;
        label: string | null;
        /** HH:mm, institute wall clock. */
        start_time: string;
        end_time: string;
    }>;
}

/** A block the caller can see nothing in (no granted lists / team outside scope). */
export interface CrmEmptyBlock {
    empty: true;
}

export interface CrmDashboardBlocks {
    summary?: CrmSummaryBlock | CrmEmptyBlock;
    followups?: CrmFollowupsBlock | CrmEmptyBlock;
    pipeline?: CrmPipelineBlock | CrmEmptyBlock;
    sources?: CrmSourceRow[] | CrmEmptyBlock;
    counsellors?: { rows: CrmCounsellorRow[] } | CrmEmptyBlock;
    calls?: CrmCallsBlock | CrmEmptyBlock;
    lists?: CrmListRow[] | CrmEmptyBlock;
    quality?: CrmQualityBlock | CrmEmptyBlock;
    views?: CrmViewsBlock | CrmEmptyBlock;
    list_stats?: { rows: CrmListStatsRow[] } | CrmEmptyBlock;
    shifts?: CrmShiftsBlock | CrmEmptyBlock;
}

export interface CrmDashboardResponse {
    from: string;
    to: string;
    previous_from: string | null;
    previous_to: string | null;
    scope_mode: string;
    admin: boolean;
    blocks: CrmDashboardBlocks;
    errors: Partial<Record<CrmBlockId, string>>;
    generated_at: string;
}

export const isEmptyBlock = (b: unknown): b is CrmEmptyBlock =>
    !!b && typeof b === 'object' && (b as CrmEmptyBlock).empty === true;

export const fetchCrmDashboard = async (
    body: CrmDashboardRequest
): Promise<CrmDashboardResponse> => {
    const res = await authenticatedAxiosInstance.post<CrmDashboardResponse>(
        CRM_DASHBOARD_URL,
        body
    );
    return res.data;
};
