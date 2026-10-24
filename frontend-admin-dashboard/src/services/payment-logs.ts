import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { PaymentLogsRequest, PaymentLogsResponse } from '@/types/payment-logs';

export const PAYMENT_LOGS_URL = `${BASE_URL}/admin-core-service/v1/user-plan/payment-logs`;
/**
 * Fetch payment logs with pagination and filtering
 */
export const fetchPaymentLogs = async (
    pageNo: number = 0,
    pageSize: number = 20,
    requestBody: Omit<PaymentLogsRequest, 'institute_id'>
): Promise<PaymentLogsResponse> => {
    const instituteId = getCurrentInstituteId();

    if (!instituteId) {
        throw new Error('Institute ID not found');
    }

    const finalRequestBody: PaymentLogsRequest = {
        ...requestBody,
        institute_id: instituteId,
    };

    const response = await authenticatedAxiosInstance.post<PaymentLogsResponse>(
        PAYMENT_LOGS_URL,
        finalRequestBody,
        {
            params: {
                pageNo,
                pageSize,
            },
        }
    );

    return response.data;
};

export const PAYMENT_LOGS_SUMMARY_URL = `${PAYMENT_LOGS_URL}/summary`;

/**
 * One group of the filtered set: rows sharing a classified status, a currency and whether they
 * can still turn into money. The server classifies exactly as the row mapper does, so a tile
 * built from these agrees with the rows the tile filters to.
 */
export interface PaymentStatusTotal {
    status: string;
    currency: string;
    due_eligible: boolean;
    count: number;
    amount: number;
}

export interface PaymentLogsSummary {
    total_count: number;
    total_amount: number;
    status_totals: PaymentStatusTotal[];
    /** Every plan the institute has, for the plan filter — not just the plans currently visible. */
    payment_plan_names: string[];
}

/**
 * Totals for every row matching the filters. Replaces walking the whole result set a page at a
 * time in the browser just to add the tiles up.
 */
export const fetchPaymentLogsSummary = async (
    requestBody: Omit<PaymentLogsRequest, 'institute_id'>
): Promise<PaymentLogsSummary> => {
    const instituteId = getCurrentInstituteId();

    if (!instituteId) {
        throw new Error('Institute ID not found');
    }

    const response = await authenticatedAxiosInstance.post<PaymentLogsSummary>(
        PAYMENT_LOGS_SUMMARY_URL,
        { ...requestBody, institute_id: instituteId }
    );

    return response.data;
};

export const BILLING_SUMMARY_URL = `${BASE_URL}/admin-core-service/v1/user-plan/payment-logs/billing-summary`;

/**
 * What came in, what learners with access still owe, and what falls due next. Amounts are in
 * `currency`.
 *
 * `due` is only ever money on granted access — an overdue instalment, a lapsed subscription
 * renewal, an unpaid invoice. An unfinished checkout is not due (nobody has access) and a one-time
 * purchase is never due (paid, or not enrolled). `total_billed` is always `collected + due`.
 */
export interface BillingSummary {
    total_billed: number;
    collected: number;
    /** Overdue right now. */
    due: number;
    /** Falls due within `upcoming_days`. Expected, not yet owed. */
    upcoming: number;
    upcoming_days: number;
    /** Distinct learners with something overdue — the rows on the Due list. */
    learners_owing: number;
    learners_upcoming: number;
    /** Live enrolments in the window. */
    plan_count: number;
    /**
     * The institute's fee model — live instalment (CPO) plans and all live plans across the whole
     * institute, whatever the date window or course filter. Null on an older server.
     */
    instalment_plan_count: number | null;
    live_plan_count: number | null;
    /**
     * Live, priced one-time plans with no payment recorded — activated by an admin by hand. Could
     * be an offline payment nobody recorded or a free grant, so it is reported, not billed.
     */
    activated_without_payment_count: number;
    /**
     * Everything still to collect on live enrolments — every unpaid instalment whatever its due
     * date, overdue renewals, unpaid invoices. Due and Upcoming are date slices of it.
     */
    outstanding: number;
    /** Distinct learners with an outstanding balance — the rows on the Outstanding list. */
    learners_outstanding: number;
    /**
     * Expected but not yet owed, whatever the date: every future instalment and invoice plus
     * renewals within `upcoming_days`. Null on an older server.
     */
    upcoming_all: number | null;
    learners_upcoming_all: number;
    /** Earliest future due date carrying money, yyyy-MM-dd. */
    next_due_date: string | null;
    /** The institute runs instalment plans (independent of the date window). */
    uses_installments: boolean;
    currency: string | null;
}

export interface BillingSummaryRequest {
    /** ISO local date-time (YYYY-MM-DDTHH:mm:ss); omit for all-time. Filters when the plan began. */
    start_date_in_utc?: string;
    end_date_in_utc?: string;
    package_session_ids?: string[];
    /** Name, email or phone. Only the learner lists (fetchOutstandingLearners) read it. */
    search_string?: string;
}

/**
 * Billing totals for the Collected / Due / Upcoming cards.
 *
 * Due comes from the obligations on the plans learners hold, not from payment rows: an overdue
 * instalment nobody has paid has no payment row at all, and a lapsed renewal leaves only the
 * failed attempt. Summing payment logs therefore cannot see what is owed — and summing plan prices
 * (the previous approach) counted every abandoned checkout and coupon discount as debt.
 */
export const fetchBillingSummary = async (
    requestBody: BillingSummaryRequest = {}
): Promise<BillingSummary> => {
    const instituteId = getCurrentInstituteId();

    if (!instituteId) {
        throw new Error('Institute ID not found');
    }

    const response = await authenticatedAxiosInstance.post(BILLING_SUMMARY_URL, {
        ...requestBody,
        institute_id: instituteId,
    });

    const d = (response.data ?? {}) as Partial<BillingSummary>;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const collected = num(d.collected);
    const due = Math.max(0, num(d.due));
    return {
        // Derived here too, so the cards reconcile even against an older server.
        total_billed: collected + due,
        collected,
        due,
        upcoming: Math.max(0, num(d.upcoming)),
        upcoming_days: num(d.upcoming_days) || 30,
        learners_owing: num(d.learners_owing),
        learners_upcoming: num(d.learners_upcoming),
        plan_count: num(d.plan_count),
        instalment_plan_count:
            typeof d.instalment_plan_count === 'number' ? d.instalment_plan_count : null,
        live_plan_count: typeof d.live_plan_count === 'number' ? d.live_plan_count : null,
        activated_without_payment_count: num(d.activated_without_payment_count),
        // An older server has no outstanding figure; Due is the closest honest floor.
        outstanding: Math.max(0, typeof d.outstanding === 'number' ? d.outstanding : due),
        learners_outstanding: num(d.learners_outstanding),
        upcoming_all: typeof d.upcoming_all === 'number' ? Math.max(0, d.upcoming_all) : null,
        learners_upcoming_all: num(d.learners_upcoming_all),
        next_due_date: typeof d.next_due_date === 'string' ? d.next_due_date : null,
        uses_installments: d.uses_installments === true,
        currency: d.currency ?? null,
    };
};

export const INSTALMENT_FORECAST_URL = `${BASE_URL}/admin-core-service/v1/user-plan/payment-logs/instalment-forecast`;

/** One calendar month of the Upcoming card. */
export interface UpcomingMonth {
    /** yyyy-MM; null for instalments with no due date. */
    month: string | null;
    amount: number;
    learners: number;
    /** Instalments, invoices and renewals behind `amount`. */
    dues: number;
    /** Earliest due date inside the month, yyyy-MM-dd. */
    first_due_on: string | null;
}

/**
 * How far the instalment plans have got, and when the rest comes in. The `instalment_*` figures
 * cover instalment plans only; `months` covers everything on the Upcoming card, so the months add
 * up to its `upcoming_all`.
 */
export interface InstalmentForecast {
    instalment_billed: number;
    instalment_paid: number;
    instalment_overdue: number;
    instalment_to_come: number;
    instalment_plans: number;
    instalment_learners: number;
    months: UpcomingMonth[];
}

/**
 * Instalment progress and the Upcoming card split by month. Same window and course scope as the
 * billing summary. Only asked for by institutes that run instalment plans.
 */
export const fetchInstalmentForecast = async (
    requestBody: BillingSummaryRequest = {}
): Promise<InstalmentForecast> => {
    const instituteId = getCurrentInstituteId();

    if (!instituteId) {
        throw new Error('Institute ID not found');
    }

    const response = await authenticatedAxiosInstance.post(INSTALMENT_FORECAST_URL, {
        ...requestBody,
        institute_id: instituteId,
    });

    const d = (response.data ?? {}) as Partial<InstalmentForecast>;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
        instalment_billed: Math.max(0, num(d.instalment_billed)),
        instalment_paid: Math.max(0, num(d.instalment_paid)),
        instalment_overdue: Math.max(0, num(d.instalment_overdue)),
        instalment_to_come: Math.max(0, num(d.instalment_to_come)),
        instalment_plans: num(d.instalment_plans),
        instalment_learners: num(d.instalment_learners),
        months: Array.isArray(d.months)
            ? d.months.map((m) => ({
                  month: typeof m?.month === 'string' ? m.month : null,
                  amount: Math.max(0, num(m?.amount)),
                  learners: num(m?.learners),
                  dues: num(m?.dues),
                  first_due_on: typeof m?.first_due_on === 'string' ? m.first_due_on : null,
              }))
            : [],
    };
};

/**
 * Get payment logs query configuration for React Query
 */
export const getPaymentLogsQueryKey = (
    pageNo: number,
    pageSize: number,
    filters: Omit<PaymentLogsRequest, 'institute_id'>
) => ['payment-logs', pageNo, pageSize, filters];

export const usePaymentLogsQuery = (
    pageNo: number,
    pageSize: number,
    filters: Omit<PaymentLogsRequest, 'institute_id'>
) => {
    return {
        queryKey: getPaymentLogsQueryKey(pageNo, pageSize, filters),
        queryFn: () => fetchPaymentLogs(pageNo, pageSize, filters),
        keepPreviousData: true,
        staleTime: 30000, // 30 seconds
    };
};

export interface UpdatePaymentLogTrackingRequest {
    payment_log_id: string;
    tracking_id: string;
    tracking_source: string;
    order_status: string;
}
export const UPDATE_PAYMENT_LOG_TRACKING_URL = `${BASE_URL}/admin-core-service/v1/user-plan/payment-logs/update-tracking`;

/**
 * Update tracking info (tracking_id, tracking_source, order_status) for a payment log row.
 */
export const updatePaymentLogTracking = async (
    request: UpdatePaymentLogTrackingRequest
): Promise<void> => {
    await authenticatedAxiosInstance.post(UPDATE_PAYMENT_LOG_TRACKING_URL, request);
};

export const OUTSTANDING_LEARNERS_URL = `${BASE_URL}/admin-core-service/v1/user-plan/payment-logs/outstanding-learners`;

/** A learner who still owes money — the drill-down behind the "Due payment" card. */
export interface OutstandingLearner {
    user_id: string;
    full_name: string | null;
    email: string | null;
    mobile_number: string | null;
    course_name: string | null;
    /** Custom Installment (CPO), Course / Package, Live Class, Sub-Org … */
    payment_type: string | null;
    plan_status: string | null;
    billed: number;
    paid: number;
    /** Overdue right now — what puts the learner on this list. */
    due: number;
    /** Falls due within the upcoming horizon. */
    upcoming: number;
    plan_count: number;
    /** CPO only: instalments still unpaid on their schedule. */
    pending_installments: number;
    /** CPO only: when the next unpaid instalment falls due (YYYY-MM-DD). */
    next_due_date: string | null;
    /** Outstanding list only: everything still to collect, whatever its due date. */
    outstanding?: number | null;
    /** Outstanding list only: what falls due on `next_due_date`. */
    next_due_amount?: number | null;
    /** Month-filtered Upcoming list only: what falls due inside the selected month. */
    month_amount?: number | null;
    currency: string | null;
}

export const LEARNER_PLAN_BREAKDOWN_URL = `${BASE_URL}/admin-core-service/v1/user-plan/payment-logs/learner-plan-breakdown`;

/** One enrolment on the Due side view. */
export interface LearnerPlanBreakdown {
    user_plan_id: string;
    course_name: string | null;
    plan_status: string | null;
    payment_type: string | null;
    billed: number;
    paid: number;
    /** Overdue on this enrolment right now. */
    due: number;
    /** Falls due on this enrolment within the upcoming horizon. */
    upcoming: number;
    /**
     * True for a live CPO / subscription plan or an unpaid invoice — the kinds that can owe. A
     * one-time purchase or a dead plan is still returned so the side view can show it, but it
     * contributes 0 to the learner's balance.
     */
    counts_towards_due: boolean;
    currency: string | null;
}

export interface OutstandingLearnersPage {
    content: OutstandingLearner[];
    totalPages: number;
    totalElements: number;
    number: number;
    size: number;
    last: boolean;
}

/**
 * Who owes what. The payment-logs endpoint can't answer this — a part-paid instalment plan leaves
 * one PAID row and an enrolment that never paid leaves none — so the balance is computed against
 * the enrolments themselves, learner by learner.
 */
export const fetchOutstandingLearners = async (
    requestBody: BillingSummaryRequest = {},
    pageNo = 0,
    pageSize = 20,
    /**
     * false: the Due list — learners with something already overdue. true: the Outstanding
     * list — anyone with a balance still to collect, soonest next instalment first.
     */
    includeNotYetDue = false,
    /** yyyy-MM: only the learners with something falling due in that month (instalment forecast). */
    dueMonth?: string | null
): Promise<OutstandingLearnersPage> => {
    const instituteId = getCurrentInstituteId();

    if (!instituteId) {
        throw new Error('Institute ID not found');
    }

    const params: Record<string, string | number | boolean> = includeNotYetDue
        ? { pageNo, pageSize, includeNotYetDue }
        : { pageNo, pageSize };
    // Only sent when a month is picked, so every other list asks the server exactly what it did.
    if (dueMonth) params.dueMonth = dueMonth;

    const response = await authenticatedAxiosInstance.post(
        OUTSTANDING_LEARNERS_URL,
        { ...requestBody, institute_id: instituteId },
        { params }
    );

    const d = (response.data ?? {}) as Partial<OutstandingLearnersPage>;
    return {
        content: Array.isArray(d.content) ? d.content : [],
        totalPages: typeof d.totalPages === 'number' ? d.totalPages : 1,
        totalElements: typeof d.totalElements === 'number' ? d.totalElements : 0,
        number: typeof d.number === 'number' ? d.number : pageNo,
        size: typeof d.size === 'number' ? d.size : pageSize,
        last: d.last ?? true,
    };
};

/**
 * Every enrolment behind one learner's Due row, cancelled ones included and flagged.
 *
 * The Due list nets a learner down to one figure, which gave an admin who had just cancelled
 * somebody's plan no way to confirm the cancellation was honoured. This is that proof.
 */
export const fetchLearnerPlanBreakdown = async (
    userId: string,
    requestBody: BillingSummaryRequest = {}
): Promise<LearnerPlanBreakdown[]> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) {
        throw new Error('Institute ID not found');
    }
    // Same window and course scope the Due row was computed under — otherwise the sheet's
    // enrolments would not add up to the totals shown above them.
    const response = await authenticatedAxiosInstance.post(
        LEARNER_PLAN_BREAKDOWN_URL,
        { ...requestBody, institute_id: instituteId },
        { params: { userId } }
    );
    return Array.isArray(response.data) ? (response.data as LearnerPlanBreakdown[]) : [];
};

/** What a void undid — echoed in the confirmation toast. */
export interface PaymentVoidResult {
    payment_log_id: string;
    amount: number | null;
    currency: string | null;
    installments_reopened: number;
    invoices_updated: number;
    credit_reversed: number | null;
}

/** Vendors whose payments were entered by an admin — the only ones that can be voided. */
const VOIDABLE_VENDORS = new Set(['MANUAL', 'OFFLINE']);

/**
 * Can this payment be voided from the admin UI? Only a PAID payment an admin recorded by hand:
 * money a gateway captured really moved and has to be refunded through the gateway instead.
 */
export const isVoidablePayment = (
    vendor: string | null | undefined,
    paymentStatus: string | null | undefined
): boolean =>
    VOIDABLE_VENDORS.has((vendor || '').trim().toUpperCase()) &&
    (paymentStatus || '').toUpperCase() === 'PAID';

/**
 * Voids a payment recorded by mistake. The server puts back everything it moved — instalments,
 * invoices, the learner's ledger, Collected — and keeps the row, struck through, for audit.
 */
export const voidPaymentLog = async (
    paymentLogId: string,
    reason?: string
): Promise<PaymentVoidResult> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) {
        throw new Error('Institute ID not found');
    }
    const response = await authenticatedAxiosInstance.post<PaymentVoidResult>(
        `${PAYMENT_LOGS_URL}/${encodeURIComponent(paymentLogId)}/void`,
        { reason: reason?.trim() || undefined },
        { params: { instituteId } }
    );
    return response.data;
};

/**
 * Can this payment be PERMANENTLY deleted (when the role is allowed to at all)? Offline / manual
 * payments that are paid or already voided; a gateway payment is refunded in the gateway instead.
 */
export const isDeletablePayment = (
    vendor: string | null | undefined,
    paymentStatus: string | null | undefined
): boolean =>
    VOIDABLE_VENDORS.has((vendor || '').trim().toUpperCase()) &&
    ['PAID', 'VOIDED'].includes((paymentStatus || '').toUpperCase());

/**
 * PERMANENTLY deletes a payment. The server refuses unless the caller's role has Display Settings
 * → Learner Management → "delete payments & invoices" on; a payment that still counts is voided
 * first, so balances, installments and invoices are put right before the rows go.
 */
/**
 * Whether the server will let this user permanently delete payments / invoices at the current
 * institute — the same check the delete endpoints run. False on any failure (fail closed).
 */
export const fetchCanDeletePayments = async (): Promise<boolean> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return false;
    try {
        const response = await authenticatedAxiosInstance.get(`${PAYMENT_LOGS_URL}/can-delete`, {
            params: { instituteId },
        });
        return response.data?.allowed === true;
    } catch {
        return false;
    }
};

export const deletePaymentLog = async (
    paymentLogId: string
): Promise<{ payment_log_id: string; amount: number | null; invoices_deleted: string[] }> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) {
        throw new Error('Institute ID not found');
    }
    const response = await authenticatedAxiosInstance.delete(
        `${PAYMENT_LOGS_URL}/${encodeURIComponent(paymentLogId)}`,
        { params: { instituteId } }
    );
    return response.data;
};

/**
 * The reason the server gave for refusing a payment action. A VacademyException comes back as
 * `{ ex: "<message>" }`; some handlers use `message`. Null when there is nothing readable.
 */
export const serverErrorMessage = (err: unknown): string | null => {
    const data = (err as { response?: { data?: { ex?: unknown; message?: unknown } } })?.response
        ?.data;
    if (typeof data?.ex === 'string' && data.ex.trim()) return data.ex;
    if (typeof data?.message === 'string' && data.message.trim()) return data.message;
    return null;
};
