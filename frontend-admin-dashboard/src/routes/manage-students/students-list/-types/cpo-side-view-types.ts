import type { OfflinePaymentDetails } from '@/services/offline-payment-modes';
// Mirrors the backend DTOs in admin_core_service for the CPO side-view
// endpoints under /admin-core-service/v1/fee-management. Snake-case wire
// format on both sides — Spring serializes via SnakeCaseStrategy and we
// keep the same shape here without any axios interceptor remapping.

export type DiscountType = 'PERCENTAGE' | 'FLAT';

export interface DiscountSpec {
    type: DiscountType;
    value: number;
    reason?: string | null;
}

// ---------- Read shapes (backend → frontend) ----------

export interface CpoUserPlanSummary {
    user_plan_id: string;
    cpo_id: string | null;
    cpo_name: string | null;
    payment_option_id: string | null;
    payment_option_name: string | null;
    status: string | null;
    /** Currency the plan is billed in; absent on plans with no PaymentPlan behind them. */
    currency?: string | null;
    gross_total: number;
    net_total: number;
    paid_total: number;
    outstanding_total: number;
    installment_count: number;
    start_date?: string | null;
    end_date?: string | null;
    /** Set when the course was enrolled with others as one admission package. */
    admission_package_id?: string | null;
}

/**
 * How a whole-plan discount is spread over the installments (CpoDiscountAllocator):
 * ALL_PROPORTIONAL is the original way (every installment, paid ones too, in proportion);
 * the others only touch what is still unpaid and are fixed when the discount is applied.
 */
export type CpoDiscountAllocation =
    | 'UNPAID_PROPORTIONAL'
    | 'UNPAID_EQUAL'
    | 'LAST_FIRST'
    | 'NEXT_FIRST'
    | 'CUSTOM'
    | 'ALL_PROPORTIONAL';

export interface DiscountEntry {
    type: DiscountType;
    value: number;
    resolved_amount?: number | null;
    /** Null/absent = ALL_PROPORTIONAL. */
    allocation?: CpoDiscountAllocation | null;
    /** Installment id → amount off, for every allocation but ALL_PROPORTIONAL. */
    shares?: Record<string, number> | null;
    reason?: string | null;
    applied_by?: string | null;
    applied_at?: string | null;
}

export interface InstallmentDiscountEntry {
    aft_installment_id?: string | null;
    type: DiscountType;
    value: number;
    resolved_amount?: number | null;
    reason?: string | null;
    applied_by?: string | null;
    applied_at?: string | null;
}

export interface ManualAmountOverrideEntry {
    previous_amount?: number | null;
    new_amount: number;
    reason?: string | null;
    applied_by?: string | null;
    applied_at?: string | null;
}

export interface HistoryEntry {
    action: string;
    scope: 'CPO' | 'INSTALLMENT';
    target_id?: string | null;
    before?: unknown;
    after?: unknown;
    by?: string | null;
    at?: string | null;
}

export interface CpoInstallmentRow {
    id: string;
    aft_installment_id?: string | null;
    original_amount: number;
    amount_expected: number;
    amount_paid: number;
    outstanding: number;
    start_date?: string | null;
    due_date?: string | null;
    status: string;
    /** Set on bills from a learner's own installment schedule. */
    installment_number?: number | null;
    /** This installment's part of the whole-plan discount; absent when it takes none. */
    plan_discount_share?: number | null;
    installment_discount?: InstallmentDiscountEntry | null;
    manual_amount_override?: ManualAmountOverrideEntry | null;
    /** Set while its dues are stopped (Stop dues): why, and what it took off. Reopen undoes it. */
    stopped_reason?: string | null;
    stopped_amount?: number | null;
    stopped_at?: string | null;
}

export interface CpoSideViewInstallmentsResponse {
    user_plan_id: string;
    user_id: string;
    cpo_id: string | null;
    gross_total: number;
    net_total: number;
    paid_total: number;
    outstanding_total: number;
    cpo_discount?: DiscountEntry | null;
    installments: CpoInstallmentRow[];
    history?: HistoryEntry[] | null;
}

// ---------- Write shapes (frontend → backend) ----------

export interface ModifyInstallmentRequest {
    start_date?: string | null;
    due_date?: string | null;
    amount?: number | null;
    clear_amount_override?: boolean;
    discount?: DiscountSpec | null;
    clear_discount?: boolean;
}

export interface ApplyCpoDiscountRequest {
    discount?: DiscountSpec | null;
    remove?: boolean;
    allocation?: CpoDiscountAllocation | null;
    /** For CUSTOM: installment id → amount off it. */
    custom_shares?: Record<string, number> | null;
}

/** What a plan discount would take off each installment; nothing is saved. */
export interface CpoDiscountPreview {
    allocation: CpoDiscountAllocation;
    requested_amount: number;
    /** Less than requested when not enough is left unpaid. */
    resolved_amount: number;
    installments: { id: string; share: number; amount_after: number }[];
}

/**
 * Move part of an installment's UNPAID balance onto a new installment with its own dates. The
 * plan total does not change — only when that part falls due.
 */
export interface SplitInstallmentRequest {
    /** Net amount to move; at most the installment's outstanding balance. */
    amount: number;
    start_date?: string | null;
    due_date: string;
}

export interface RecordOfflinePaymentRequest {
    amount: number;
    payment_date?: string | null;
    reference?: string | null;
    currency?: string | null;
    generate_invoice?: boolean;
    /** How it was paid (mode, option, reference, proof). */
    payment_details?: OfflinePaymentDetails | null;
}

/** One admission package in the side view (AdmissionPackageSummaryDTO). */
export interface AdmissionPackageSummary {
    id: string;
    created_at?: string | null;
    discount_reason?: string | null;
    currency?: string | null;
    fee_total: number;
    discount_total: number;
    /** What is billed now, after any later change to a course's bills. */
    net_total: number;
    paid_total: number;
    outstanding_total: number;
    next_due_date?: string | null;
    next_due_amount?: number | null;
    courses: AdmissionPackageCourseSummary[];
    /** Every course's bills on a due date added together. */
    installments: AdmissionPackageInstallment[];
}

export interface AdmissionPackageCourseSummary {
    user_plan_id: string;
    package_session_id: string;
    course_name?: string | null;
    plan_status?: string | null;
    fee: number;
    discount: number;
    net: number;
    paid: number;
    outstanding: number;
}

export interface AdmissionPackageInstallment {
    due_date: string;
    amount: number;
    paid: number;
    outstanding: number;
    /** While its dues are stopped: what was taken off, and why. */
    stopped?: number | null;
    stopped_reason?: string | null;
    status: 'PAID' | 'PARTIAL_PAID' | 'OVERDUE' | 'DUE' | 'STOPPED';
}

/** How a package payment would be shared between the courses. */
export interface AdmissionPackagePaymentPreview {
    amount: number;
    outstanding_total: number;
    courses: { user_plan_id: string; course_name?: string | null; amount: number }[];
}

/** Stop dues on an installment: it (or it and every later one) stops being owed. */
export interface StopDuesRequest {
    /** Package only: the package installment, by its due date. */
    due_date?: string;
    include_later: boolean;
    reason: string;
    /** Also remove the learner from the course(s): access ends now. */
    remove_from_course: boolean;
}

export interface StopDuesResult {
    stopped: number;
    reopened: number;
    removed_from_courses: number;
    removal_errors?: string[] | null;
}
