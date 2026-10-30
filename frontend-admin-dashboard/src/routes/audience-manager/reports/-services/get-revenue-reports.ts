/**
 * Data layer for the Reports Center money tabs:
 *
 *   GET /admin-core-service/v1/reports/revenue           (Revenue tab)
 *   GET /admin-core-service/v1/reports/cohort-analysis   (Cohort tab)
 *   GET /admin-core-service/v1/reports/revenue-forecast  (Forecast tab)
 *
 * Revenue counts only PAID payments from CONVERTED leads ("revenue comes after the lead is
 * converted"), attributed to the lead's source/counsellor. Admissions / booked fee count the
 * converted leads enrolled in the window and the full fee on those enrolments. Same instituteId + optional
 * fromDate/toDate (yyyy-MM-dd, institute TZ) + teamId/counsellorUserId narrowing as the rest of the
 * suite; every endpoint is RBAC-scoped server-side. All payloads are snake_case.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import type { CrmReportParams } from './get-crm-reports';

const REVENUE_URL = `${BASE_URL}/admin-core-service/v1/reports/revenue`;
const COHORT_URL = `${BASE_URL}/admin-core-service/v1/reports/cohort-analysis`;
const FORECAST_URL = `${BASE_URL}/admin-core-service/v1/reports/revenue-forecast`;

function toRequestParams(p: CrmReportParams) {
    return {
        instituteId: p.instituteId,
        fromDate: p.fromDate,
        toDate: p.toDate,
        teamId: p.teamId,
        counsellorUserId: p.counsellorUserId,
    };
}

const paramsKey = (p: CrmReportParams) =>
    [p.instituteId, p.fromDate, p.toDate, p.teamId, p.counsellorUserId] as const;

// ── GET /v1/reports/revenue ────────────────────────────────────────────

export interface RevenueTotals {
    revenue: number;
    paying_leads: number;
    payments: number;
    avg_deal_value: number | null;
    /** Converted leads enrolled in the window. */
    admissions: number;
    /** Full fee on those enrolments, collected or not. */
    booked_revenue: number;
}

export interface RevenueSourceRow {
    source_type: string;
    revenue: number;
    paying_leads: number;
    payments: number;
    avg_deal_value: number | null;
}

export interface RevenueCounsellorRow {
    user_id: string;
    name: string | null;
    revenue: number;
    paying_leads: number;
    payments: number;
    avg_deal_value: number | null;
    admissions: number;
    booked_revenue: number;
}

export interface RevenueDayPoint {
    date: string;
    revenue: number;
    payments: number;
}

export interface RevenueReport {
    currency: string;
    totals: RevenueTotals | null;
    by_source: RevenueSourceRow[];
    by_counsellor: RevenueCounsellorRow[];
    trend: RevenueDayPoint[];
}

export const revenueQueryKey = (p: CrmReportParams) =>
    ['crm-reports-revenue', ...paramsKey(p)] as const;

export async function fetchRevenue(p: CrmReportParams): Promise<RevenueReport> {
    const { data } = await authenticatedAxiosInstance.get(REVENUE_URL, {
        params: toRequestParams(p),
    });
    return {
        currency: data?.currency ?? 'INR',
        totals: data?.totals ?? null,
        by_source: Array.isArray(data?.by_source) ? data.by_source : [],
        by_counsellor: Array.isArray(data?.by_counsellor) ? data.by_counsellor : [],
        trend: Array.isArray(data?.trend) ? data.trend : [],
    };
}

// ── GET /v1/reports/cohort-analysis ────────────────────────────────────

export interface CohortRow {
    cohort: string; // yyyy-MM
    leads: number;
    converted: number;
    conversion_rate: number | null;
    revenue: number;
    avg_deal_value: number | null;
    revenue_per_lead: number | null;
    median_days_to_convert: number | null;
}

export interface CohortAnalysisReport {
    currency: string;
    cohorts: CohortRow[];
}

export const cohortQueryKey = (p: CrmReportParams) =>
    ['crm-reports-cohort', ...paramsKey(p)] as const;

export async function fetchCohortAnalysis(p: CrmReportParams): Promise<CohortAnalysisReport> {
    const { data } = await authenticatedAxiosInstance.get(COHORT_URL, {
        params: toRequestParams(p),
    });
    return {
        currency: data?.currency ?? 'INR',
        cohorts: Array.isArray(data?.cohorts) ? data.cohorts : [],
    };
}

// ── GET /v1/reports/revenue-forecast ───────────────────────────────────

export interface ForecastAssumptions {
    trailing_days: number;
    trailing_revenue: number;
    avg_daily_revenue: number;
    trailing_leads: number;
    trailing_conversions: number;
    historical_conversion_rate: number | null;
    avg_deal_value: number | null;
    open_pipeline_leads: number;
}

export interface ForecastHorizon {
    days: number;
    run_rate_revenue: number;
    pipeline_revenue: number;
    blended_revenue: number;
}

export interface RevenueForecast {
    currency: string;
    assumptions: ForecastAssumptions | null;
    horizons: ForecastHorizon[];
}

export const forecastQueryKey = (p: CrmReportParams) =>
    ['crm-reports-forecast', ...paramsKey(p)] as const;

export async function fetchRevenueForecast(p: CrmReportParams): Promise<RevenueForecast> {
    const { data } = await authenticatedAxiosInstance.get(FORECAST_URL, {
        params: toRequestParams(p),
    });
    return {
        currency: data?.currency ?? 'INR',
        assumptions: data?.assumptions ?? null,
        horizons: Array.isArray(data?.horizons) ? data.horizons : [],
    };
}
