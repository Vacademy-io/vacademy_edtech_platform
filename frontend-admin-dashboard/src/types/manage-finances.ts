import type { OfflinePaymentDetails } from '@/services/offline-payment-modes';
// ─── Search / Filter DTO ────────────────────────────────────────────────────
export interface FeeSearchFilterDTO {
    page: number; // 0-indexed
    size: number;
    sortBy: string; // studentName | cpoName | totalExpectedAmount | totalPaidAmount | dueAmount | overdueAmount | status
    sortDirection: 'ASC' | 'DESC';
    filters: {
        packageSessionIds?: string[];
        cpoIds?: string[];
        feeTypeIds?: string[];
        statuses?: string[]; // PAID | OVERDUE | PARTIAL | PENDING
        studentSearchQuery?: string;
    };
}

// ─── Main Table Row (Aggregated: Student + CPO) ─────────────────────────────
export interface StudentFeePaymentRowDTO {
    student_id: string;
    cpo_id: string;
    package_session_ids: string[];
    student_name: string;
    phone: string;
    email: string | null;
    cpo_name: string;
    total_expected_amount: number;
    total_paid_amount: number;
    due_amount: number;
    overdue_amount: number;
    status: 'PAID' | 'OVERDUE' | 'PARTIAL' | 'PENDING';
    installment_statuses: string[]; // per-installment statuses ordered by due date
}

// ─── Paginated Response (Spring Boot Page) ──────────────────────────────────
export interface FinancalManagementPaginatedResponse {
    content: StudentFeePaymentRowDTO[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
    last: boolean;
    // snake_case variants from backend
    total_elements?: number;
    total_pages?: number;
    page_no?: number;
    page_size?: number;
}

// ─── Installment Detail (Popup) ─────────────────────────────────────────────
export interface InstallmentDetailDTO {
    fee_type_name: string;
    installment_number: number;
    amount_expected: number;
    adjustment_amount: number;
    adjustment_type: string | null;
    adjustment_status: string | null;
    amount_paid: number;
    due_amount: number;
    due_date: string; // ISO datetime
    status: 'PAID' | 'OVERDUE' | 'PARTIAL' | 'PENDING';
}

// ─── Student Dues (Pay Installments) ───────────────────────────────────────
export interface StudentFeeDueDTO {
    id: string;
    user_id: string;
    student_name: string | null;
    user_plan_id: string;
    cpo_id: string;
    cpo_name: string;
    fee_type_name: string;
    fee_type_code: string;
    fee_type_description: string;
    amount_expected: number;
    adjustment_amount: number;
    adjustment_type: string | null;
    adjustment_status: string | null;
    adjustment_reason: string | null;
    amount_paid: number;
    amount_due: number;
    due_date: string; // ISO datetime
    status: string;
    is_overdue: boolean;
    days_overdue: number;
}

// ─── Allocate Selected Payment Request ─────────────────────────────────────
export interface AllocateSelectedRequest {
    institute_id: string;
    student_fee_payment_ids: string[];
    amount: number;
    remarks?: string;
    /** How it was paid (mode, option, reference, proof). */
    payment_details?: OfflinePaymentDetails | null;
}

// ─── Adjustment History (Pay Installments dialog) ──────────────────────────
export interface AdjustmentHistoryDTO {
    id: string;
    student_fee_payment_id: string;
    event_type: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETRACTED';
    adjustment_type: string;
    amount: number;
    reason: string | null;
    resulting_status: string;
    actor_user_id: string;
    actor_name: string | null;
    actor_role: string | null;
    previous_event_id: string | null;
    metadata: string | null;
    created_at: string;
}

export interface AdjustmentHistoryPageResponse {
    content: AdjustmentHistoryDTO[];
    number: number;
    size: number;
    total_elements: number;
    totalElements?: number;
    total_pages: number;
    totalPages?: number;
    last: boolean;
}

// ─── Institute-wide Adjustment History (Adjustment Approvals page) ─────────
export interface InstituteAdjustmentHistoryFilter {
    page?: number;
    size?: number;
    event_types?: ('SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETRACTED')[];
    adjustment_types?: ('CONCESSION' | 'PENALTY')[];
    resulting_statuses?: ('PENDING_FOR_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETRACTED')[];
    actor_user_id?: string;
    start_date?: string; // yyyy-MM-dd
    end_date?: string;   // yyyy-MM-dd
    student_search?: string;
}

export interface EnrichedAdjustmentHistoryDTO extends AdjustmentHistoryDTO {
    student_user_id?: string | null;
    student_name?: string | null;
    student_phone?: string | null;
    fee_type_name?: string | null;
    cpo_name?: string | null;
    installment_due_date?: string | null;
}

export interface EnrichedAdjustmentHistoryPageResponse {
    content: EnrichedAdjustmentHistoryDTO[];
    number: number;
    size: number;
    total_elements: number;
    totalElements?: number;
    total_pages: number;
    totalPages?: number;
    last: boolean;
}
