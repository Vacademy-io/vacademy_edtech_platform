/**
 * Service layer for the Lead Reports page — calls the two read-only backend endpoints
 * (`/reports/leads/summary`, `/reports/counselor-performance`) and exposes their response shapes.
 * All values are institute-scoped and date-bounded; the backend defaults to the last 30 days
 * when `from_date` / `to_date` are omitted.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_COUNSELOR_PERFORMANCE, GET_LEAD_REPORT_SUMMARY } from '@/constants/urls';

// ── Lead summary ────────────────────────────────────────────────────────

export interface LeadReportTotals {
    total_leads: number;
    converted_leads: number;
    lost_leads: number;
    active_leads: number;
    conversion_rate: number | null;
    responded_leads: number | null;
    avg_response_minutes: number | null;
    tat_met_count: number | null;
    tat_met_rate: number | null;
    overdue_leads: number;
}

export interface StatusBreakdown {
    status_key: string;
    label: string;
    color: string | null;
    count: number;
}

export interface SourceBreakdown {
    source_type: string;
    total: number;
    converted: number;
}

export interface TierBreakdown {
    tier: string; // HOT / WARM / COLD / UNCLASSIFIED
    count: number;
}

export interface DailyTrendPoint {
    date: string; // yyyy-MM-dd
    submitted: number;
    converted: number;
}

export interface LeadReportSummary {
    from_date: string;
    to_date: string;
    totals: LeadReportTotals;
    by_status: StatusBreakdown[];
    by_source: SourceBreakdown[];
    by_tier: TierBreakdown[];
    trend_by_day: DailyTrendPoint[];
}

export async function fetchLeadReportSummary(
    instituteId: string,
    fromDate?: string,
    toDate?: string,
    teamId?: string,
    counsellorUserId?: string,
    audienceId?: string
): Promise<LeadReportSummary> {
    const { data } = await authenticatedAxiosInstance.get(GET_LEAD_REPORT_SUMMARY, {
        params: { instituteId, fromDate, toDate, teamId, counsellorUserId, audienceId },
    });
    return data;
}

// ── Counsellor performance ─────────────────────────────────────────────

export interface CounselorRow {
    counselor_id: string;
    counselor_name: string;
    leads_assigned: number;
    leads_responded: number;
    conversions: number;
    conversion_rate: number | null;
    avg_response_minutes: number | null;
    tat_met_count: number | null;
    tat_met_rate: number | null;
    open_leads: number;
    overdue_leads: number;
}

export interface CounselorPerformance {
    from_date: string;
    to_date: string;
    /** TAT threshold in minutes used for tat_met (null when TAT is disabled). */
    tat_minutes?: number | null;
    /** Same threshold in whole hours, rounded up — prefer tat_minutes. */
    tat_hours: number | null;
    rows: CounselorRow[];
    summary: {
        total_counselors: number;
        avg_response_minutes: number | null;
        avg_conversion_rate: number | null;
    };
}

export async function fetchCounselorPerformance(
    instituteId: string,
    fromDate?: string,
    toDate?: string,
    teamId?: string,
    counsellorUserId?: string,
    audienceId?: string
): Promise<CounselorPerformance> {
    const { data } = await authenticatedAxiosInstance.get(GET_COUNSELOR_PERFORMANCE, {
        params: { instituteId, fromDate, toDate, teamId, counsellorUserId, audienceId },
    });
    return data;
}
