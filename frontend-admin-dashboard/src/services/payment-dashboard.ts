import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export const PAYMENT_DASHBOARD_URL = `${BASE_URL}/admin-core-service/v1/user-plan/payment-logs/dashboard`;

export interface PaymentDashboardRequest {
    /** ISO local date-time (YYYY-MM-DDTHH:mm:ss, UTC). Omit for all time. */
    start_date_in_utc?: string;
    end_date_in_utc?: string;
    package_session_ids?: string[];
    /** IANA zone the months and days are cut in. */
    time_zone?: string;
}

export interface DashboardKpis {
    collected: number;
    previous_collected: number | null;
    payments: number;
    previous_payments: number | null;
    paying_learners: number;
    previous_paying_learners: number | null;
    new_paying_learners: number;
    previous_new_paying_learners: number | null;
    overdue: number;
    learners_overdue: number;
    due_soon: number;
    learners_due_soon: number;
    upcoming_days: number;
    still_to_come: number;
    learners_still_to_come: number;
    collected_all_time: number;
    outstanding: number;
}

export interface DashboardSeriesPoint {
    bucket: string;
    collected: number;
    payments: number;
    payers: number;
    new_payers: number | null;
}

export interface DashboardYearPoint {
    financial_year: string;
    collected: number;
    partial: boolean;
}

export interface DashboardSlice {
    key: string | null;
    amount: number;
    payments: number;
    payers: number;
}

export interface DashboardBatchRow {
    package_session_id: string | null;
    package_id: string | null;
    package_name: string | null;
    level_name: string | null;
    session_name: string | null;
    collected: number;
    collected_all_time: number;
    overdue: number;
    still_to_come: number;
    learners: number;
}

export interface DashboardAgeingBucket {
    bucket: 'D0_30' | 'D31_60' | 'D61_90' | 'D90_PLUS' | 'UNDATED' | string;
    amount: number;
    learners: number;
    oldest_days: number | null;
}

export interface DashboardForecastMonth {
    month: string | null;
    amount: number;
    learners: number;
}

/**
 * Everything the Payment Dashboard draws. Flows (collected, payers, sources, methods, series)
 * cover the chosen period; balances (overdue, due soon, still to come, ageing, forecast, batch
 * balances) are as of today on every live enrolment. See PaymentDashboardResponseDTO.
 */
export interface PaymentDashboard {
    period_start: string | null;
    period_end: string;
    previous_start: string | null;
    previous_end: string | null;
    time_zone: string;
    currency: string | null;
    kpis: DashboardKpis;
    months: DashboardSeriesPoint[];
    years: DashboardYearPoint[];
    days: DashboardSeriesPoint[];
    sources: DashboardSlice[];
    methods: DashboardSlice[];
    batches: DashboardBatchRow[];
    ageing: DashboardAgeingBucket[];
    forecast: DashboardForecastMonth[];
}

export const fetchPaymentDashboard = async (
    request: PaymentDashboardRequest
): Promise<PaymentDashboard> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) {
        throw new Error('Institute ID not found');
    }
    const response = await authenticatedAxiosInstance.post<PaymentDashboard>(
        PAYMENT_DASHBOARD_URL,
        {
            ...request,
            institute_id: instituteId,
        }
    );
    const d = response.data;
    // Lists default to empty so a partial response never takes a panel down.
    return {
        ...d,
        months: d?.months ?? [],
        years: d?.years ?? [],
        days: d?.days ?? [],
        sources: d?.sources ?? [],
        methods: d?.methods ?? [],
        batches: d?.batches ?? [],
        ageing: d?.ageing ?? [],
        forecast: d?.forecast ?? [],
    };
};
