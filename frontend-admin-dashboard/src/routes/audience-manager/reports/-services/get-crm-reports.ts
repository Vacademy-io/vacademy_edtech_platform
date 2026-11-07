/**
 * Data layer for the Reports Center's Wave-1 CRM report endpoints:
 *
 *   GET /admin-core-service/v1/reports/source-performance   (Sources tab)
 *   GET /admin-core-service/v1/reports/funnel-velocity      (Funnel tab)
 *   GET /admin-core-service/v1/reports/followup-aging       (Follow-ups tab)
 *   GET /admin-core-service/v1/reports/dispositions         (post-call disposition reporting)
 *
 * (calls-daily / calls-heatmap live in -components/calling/calling-reports-service.ts —
 * the Calling tab is built independently with disjoint file ownership.)
 *
 * All requests take instituteId + optional fromDate/toDate (yyyy-MM-dd, institute
 * timezone) + optional teamId/counsellorUserId narrowing. Every endpoint is
 * RBAC-scoped server-side to the caller's leads-subtree visibility. All response
 * payloads are snake_case per the backend contract.
 */
import { isAxiosError } from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

// authenticatedAxiosInstance has no baseURL and there's no Vite dev proxy for
// /admin-core-service, so endpoints must include the backend host.
const SOURCE_PERFORMANCE_URL = `${BASE_URL}/admin-core-service/v1/reports/source-performance`;
const FUNNEL_VELOCITY_URL = `${BASE_URL}/admin-core-service/v1/reports/funnel-velocity`;
const FOLLOWUP_AGING_URL = `${BASE_URL}/admin-core-service/v1/reports/followup-aging`;
const DISPOSITIONS_URL = `${BASE_URL}/admin-core-service/v1/reports/dispositions`;

// ── Shared request params ──────────────────────────────────────────────

export interface CrmReportParams {
    instituteId: string;
    /** yyyy-MM-dd (inclusive, institute timezone). */
    fromDate?: string;
    /** yyyy-MM-dd (inclusive, institute timezone). */
    toDate?: string;
    teamId?: string;
    counsellorUserId?: string;
    /** Campaign (audience) id — scopes the report to a single campaign. */
    audienceId?: string;
}

function toRequestParams(p: CrmReportParams) {
    return {
        instituteId: p.instituteId,
        fromDate: p.fromDate,
        toDate: p.toDate,
        teamId: p.teamId,
        counsellorUserId: p.counsellorUserId,
        audienceId: p.audienceId,
    };
}

const paramsKey = (p: CrmReportParams) =>
    [p.instituteId, p.fromDate, p.toDate, p.teamId, p.counsellorUserId, p.audienceId] as const;

// ── Error classification ───────────────────────────────────────────────

/**
 * True when the reports endpoints don't exist on this backend yet (the
 * immediate post-merge reality until the next backend deploy). The prod
 * gateway answers unknown paths with an empty 403 rather than a 404, so both
 * are treated as "deploy pending" — genuine RBAC denials on these endpoints
 * surface as zeroed reports (scope CSV = ""), never as 403s.
 */
export function isReportEndpointMissing(error: unknown): boolean {
    return (
        isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 403)
    );
}

// ── GET /v1/reports/source-performance ─────────────────────────────────

export interface SourcePerformanceRow {
    /** WEBSITE / GOOGLE_ADS / … ('UNKNOWN' when untagged); null on the totals row. */
    source_type: string | null;
    /** Set when source_type is the leads' campaign type. */
    campaign_type?: string | null;
    leads: number;
    connected_leads: number;
    interested: number;
    won: number;
    /** % 0–100; null when leads = 0. */
    conversion_rate: number | null;
    /** PAID revenue from this source's converted leads, in-window (institute currency). */
    revenue: number;
    /** Wave 2 (ad-spend ingestion) — always null for now. */
    spend: number | null;
    /** Wave 2 — always null for now. */
    cpl: number | null;
    /** Wave 3 — always null for now. */
    roi: number | null;
}

export interface SourcePerformanceReport {
    rows: SourcePerformanceRow[];
    /** Column sums across all rows; conversion_rate recomputed over the sums. */
    totals: SourcePerformanceRow | null;
}

export const sourcePerformanceQueryKey = (p: CrmReportParams) =>
    ['crm-reports-source-performance', ...paramsKey(p)] as const;

export async function fetchSourcePerformance(p: CrmReportParams): Promise<SourcePerformanceReport> {
    const { data } = await authenticatedAxiosInstance.get(SOURCE_PERFORMANCE_URL, {
        params: toRequestParams(p),
    });
    return {
        rows: Array.isArray(data?.rows) ? data.rows : [],
        totals: data?.totals ?? null,
    };
}

// ── GET /v1/reports/funnel-velocity ────────────────────────────────────

export interface FunnelStage {
    status_key: string;
    label: string;
    color: string | null;
    display_order: number;
    /** Transitions into the stage in-window. */
    entered: number;
    /** Leads holding this status right now (point-in-time). */
    current_stock: number;
    /** Median days spent in the stage; null when no completed in-window stints. */
    median_days_in_stage: number | null;
    advanced: number;
    /** % 0–100; null when entered = 0. */
    advanced_rate: number | null;
    regressed: number;
}

export interface FunnelVelocityReport {
    stages: FunnelStage[];
    overall: {
        median_days_to_convert: number | null;
        conversion_rate: number | null;
    } | null;
}

export const funnelVelocityQueryKey = (p: CrmReportParams) =>
    ['crm-reports-funnel-velocity', ...paramsKey(p)] as const;

export async function fetchFunnelVelocity(p: CrmReportParams): Promise<FunnelVelocityReport> {
    const { data } = await authenticatedAxiosInstance.get(FUNNEL_VELOCITY_URL, {
        params: toRequestParams(p),
    });
    return {
        stages: Array.isArray(data?.stages) ? data.stages : [],
        overall: data?.overall ?? null,
    };
}

// ── GET /v1/reports/followup-aging ─────────────────────────────────────

export type FollowupAgingBucketKey =
    | 'DUE_TODAY'
    | 'OVERDUE_1_3'
    | 'OVERDUE_3_7'
    | 'OVERDUE_7_PLUS'
    | 'UPCOMING';

export interface FollowupAgingBucket {
    key: FollowupAgingBucketKey;
    count: number;
}

export interface FollowupAgingCounsellorRow {
    user_id: string;
    /** Hydrated via auth-service batch lookup; null when hydration fails. */
    name: string | null;
    due_today: number;
    overdue_1_3: number;
    overdue_3_7: number;
    overdue_7_plus: number;
    upcoming: number;
    /** MAX days past due across open follow-ups; null when none overdue. */
    oldest_overdue_days: number | null;
}

export interface FollowupClosureReason {
    /** Trimmed closer_reason; blank/null normalized to "(no reason)" server-side. */
    reason: string;
    count: number;
}

export interface FollowupAgingReport {
    buckets: FollowupAgingBucket[];
    by_counsellor: FollowupAgingCounsellorRow[];
    /** Top closure reasons over follow-ups closed in the trailing 30 days. */
    closure_reasons: FollowupClosureReason[];
}

export const followupAgingQueryKey = (p: CrmReportParams) =>
    ['crm-reports-followup-aging', ...paramsKey(p)] as const;

export async function fetchFollowupAging(p: CrmReportParams): Promise<FollowupAgingReport> {
    const { data } = await authenticatedAxiosInstance.get(FOLLOWUP_AGING_URL, {
        params: toRequestParams(p),
    });
    return {
        buckets: Array.isArray(data?.buckets) ? data.buckets : [],
        by_counsellor: Array.isArray(data?.by_counsellor) ? data.by_counsellor : [],
        closure_reasons: Array.isArray(data?.closure_reasons) ? data.closure_reasons : [],
    };
}

// ── GET /v1/reports/dispositions ───────────────────────────────────────

export interface DispositionStatusMeta {
    status_key: string;
    label: string;
    color: string | null;
}

export interface DispositionActorRow {
    /** auth-service user id, or the synthetic "SYSTEM" actor. */
    user_id: string;
    /** Hydrated name; "System/Workflow" for SYSTEM. */
    name: string | null;
    total_changes: number;
    /** status_key → transition count. */
    changes: Record<string, number>;
    /** Assigned leads with no status-change history — never worked on. */
    pending_count: number;
}

export interface DispositionCallOutcomeRow {
    user_id: string;
    name: string | null;
    /** CALL_STATUS → call count. */
    outcomes: Record<string, number>;
}

export interface DispositionCurrentStatusRow {
    /** auth-service user id, or the synthetic "UNASSIGNED" bucket. */
    user_id: string;
    /** Hydrated name; "Unassigned" for UNASSIGNED. */
    name: string | null;
    /** The counsellor's leads received in the range = Σ statuses + no_status_count. */
    total_leads: number;
    /** status_key → in-range leads CURRENTLY holding that status. */
    statuses: Record<string, number>;
    /** In-range leads with no status at all (never dispositioned). */
    no_status_count: number;
}

export interface DispositionReport {
    /** Active status catalog in display_order — the stable column set. */
    statuses: DispositionStatusMeta[];
    rows: DispositionActorRow[];
    call_outcomes: DispositionCallOutcomeRow[];
    /** In-range leads per counsellor, bucketed by the status each lead holds now. */
    current_status_rows: DispositionCurrentStatusRow[];
}

export const dispositionsQueryKey = (p: CrmReportParams) =>
    ['crm-reports-dispositions', ...paramsKey(p)] as const;

export async function fetchDispositions(p: CrmReportParams): Promise<DispositionReport> {
    const { data } = await authenticatedAxiosInstance.get(DISPOSITIONS_URL, {
        params: toRequestParams(p),
    });
    return {
        statuses: Array.isArray(data?.statuses) ? data.statuses : [],
        rows: Array.isArray(data?.rows) ? data.rows : [],
        call_outcomes: Array.isArray(data?.call_outcomes) ? data.call_outcomes : [],
        current_status_rows: Array.isArray(data?.current_status_rows)
            ? data.current_status_rows
            : [],
    };
}
