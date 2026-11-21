/**
 * Data layer for the Reports Center Conversions tab:
 *
 *   GET /admin-core-service/v1/reports/conversions
 *
 * A conversion is a lead's enrolment into a course whose "count enrolment as conversion" setting
 * is on, dated by the enrolment — read from enrolment rows, so a pipeline status picked later
 * (e.g. "Sales Won") cannot hide it. Same instituteId + optional fromDate/toDate (yyyy-MM-dd,
 * institute TZ) + teamId/counsellorUserId narrowing as the rest of the suite; RBAC-scoped
 * server-side. Payload is snake_case.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import type { CrmReportParams } from './get-crm-reports';

const CONVERSIONS_URL = `${BASE_URL}/admin-core-service/v1/reports/conversions`;

export interface ConversionTotals {
    converted_leads: number;
    /**
     * Admissions: a student x the month they enrolled, as the Admissions tab counts them, so a
     * course package is one admission however many courses it holds. Absent from an older backend.
     */
    admissions?: number;
    /** Course enrolments (a lead enrolled into two courses counts twice). */
    enrolments: number;
}

export interface ConversionCounsellorRow {
    /** null = leads with no counsellor. */
    user_id: string | null;
    name: string | null;
    converted_leads: number;
    /** Admissions (student x month); absent from an older backend. */
    admissions?: number;
    enrolments: number;
}

export interface ConversionLeadRow {
    enrolment_id: string;
    user_id: string;
    lead_name: string | null;
    phone: string | null;
    email: string | null;
    package_id: string | null;
    course_name: string | null;
    /** Institute-local yyyy-MM-ddTHH:mm. */
    enrolled_at: string | null;
    enrolment_status: string | null;
    counsellor_id: string | null;
    counsellor_name: string | null;
    campaign_name: string | null;
    /** The lead's source: its first enquiry's campaign type, else the source type. */
    source_type: string | null;
    /**
     * True when this enrolment's fee plan also covers another row, which carries the plan's
     * amounts — the money fields are then null so a plan is never counted twice.
     */
    plan_shared: boolean;
    /** Booked fee of the enrolment's plan; null = no fee plan. */
    fee: number | null;
    paid: number | null;
    installments: number | null;
    installments_paid: number | null;
    /** What is left on the next unpaid installment, and its due date (yyyy-MM-dd). */
    next_due_amount: number | null;
    next_due_date: string | null;
}

export interface ConversionReport {
    totals: ConversionTotals;
    by_counsellor: ConversionCounsellorRow[];
    leads: ConversionLeadRow[];
    leads_truncated: boolean;
    /** ISO currency of the fee amounts. */
    currency: string;
}

export const conversionsQueryKey = (p: CrmReportParams) =>
    ['crm-reports-conversions', p.instituteId, p.fromDate, p.toDate, p.teamId, p.counsellorUserId] as const;

export async function fetchConversions(p: CrmReportParams): Promise<ConversionReport> {
    const { data } = await authenticatedAxiosInstance.get(CONVERSIONS_URL, {
        params: {
            instituteId: p.instituteId,
            fromDate: p.fromDate,
            toDate: p.toDate,
            teamId: p.teamId,
            counsellorUserId: p.counsellorUserId,
        },
    });
    return {
        totals: data?.totals ?? { converted_leads: 0, enrolments: 0 },
        by_counsellor: Array.isArray(data?.by_counsellor) ? data.by_counsellor : [],
        leads: Array.isArray(data?.leads) ? data.leads : [],
        leads_truncated: !!data?.leads_truncated,
        currency: data?.currency ?? 'INR',
    };
}
