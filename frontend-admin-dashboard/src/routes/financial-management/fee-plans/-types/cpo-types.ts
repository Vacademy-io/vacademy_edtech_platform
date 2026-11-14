// ─── Response / Display Types (snake_case to match backend) ────────────────────

export interface CPOInstallment {
    id: string;
    installment_number: number;
    amount: number;
    due_date: string;
    start_date?: string | null;
    end_date?: string | null;
    status: string;
}

export interface AssignedFeeValue {
    id: string;
    amount: number;
    no_of_installments: number;
    has_installment: boolean;
    is_refundable: boolean;
    has_penalty: boolean;
    penalty_percentage: number | null;
    status: string;
    installments: CPOInstallment[];
    original_amount?: number;
    discount_type?: string | null;
    discount_value?: number;
}

export interface CPOFeeType {
    id: string;
    name: string;
    code: string;
    description: string;
    status: string;
    assigned_fee_value: AssignedFeeValue;
}

export interface CPOPackageSessionLink {
    enroll_invite_id: string | null;
    package_session_id: string;
}

export interface CPOPackage {
    id: string;
    name: string;
    institute_id: string;
    default_payment_option_id: string | null;
    status: string;
    created_by?: string | null;
    approved_by?: string | null;
    fee_types: CPOFeeType[];
    package_session_links?: CPOPackageSessionLink[];
    /** FIXED (default): installments are part of the plan. FLEXIBLE: chosen per learner at enrollment. */
    schedule_mode?: CPOScheduleMode | null;
    flexible_defaults?: CPOFlexibleDefaults | null;
}

export type CPOScheduleMode = 'FIXED' | 'FLEXIBLE';

/** Defaults of a FLEXIBLE plan: prefill the Enroll wizard; used when no schedule is chosen. */
export interface CPOFlexibleDefaults {
    count?: number | null;
    interval?: { unit: 'DAYS' | 'MONTHS'; value: number } | null;
    max_count?: number | null;
}

// ─── Paginated list response ────────────────────────────────────────────────────

export interface CPOListResponse {
    content: CPOPackage[];
    total_pages: number;
    total_elements: number;
    page_no: number;
    page_size: number;
}

export interface CPOListPageable {
    paged: boolean;
    unpaged: boolean;
    pageNumber: number;
    pageSize: number;
    offset: number;
    sort: {
        unsorted: boolean;
        sorted: boolean;
        empty: boolean;
    };
}

export interface CPOListApiResponse {
    totalElements: number;
    totalPages: number;
    numberOfElements: number;
    pageable: CPOListPageable;
    size: number;
    content: CPOPackage[];
    number: number;
    sort: {
        unsorted: boolean;
        sorted: boolean;
        empty: boolean;
    };
    first: boolean;
    last: boolean;
    empty: boolean;
}

// ─── Create / Update payload types ─────────────────────────────────────────────

export interface CPOInstallmentPayload {
    id: string | null;
    installment_number: number;
    amount: number;
    status: string;
    start_date: string | null;
    end_date: string | null;
    due_date: string;
}

export interface AssignedFeeValuePayload {
    id: string | null;
    amount: number;
    no_of_installments: number;
    has_installment: boolean;
    is_refundable: boolean;
    has_penalty: boolean;
    penalty_percentage: number | null;
    status: string;
    installments: CPOInstallmentPayload[];
    original_amount: number;
    discount_type: string | null;
    discount_value: number;
}

export interface CPOFeeTypePayload {
    id: string | null;
    name: string;
    code: string;
    description: string;
    status: string;
    assigned_fee_value: AssignedFeeValuePayload;
}

export interface CreateCPOPayload {
    id: string | null;
    name: string;
    institute_id: string;
    default_payment_option_id: string | null;
    status: string;
    created_by: string | null;
    approved_by: string | null;
    /** Mirrored onto payment_option.require_approval; gates enrollment behind admin approval. */
    require_approval?: boolean;
    /** Omitted = FIXED. FLEXIBLE plans carry no installments. */
    schedule_mode?: CPOScheduleMode;
    flexible_defaults?: CPOFlexibleDefaults | null;
    fee_types: CPOFeeTypePayload[];
    package_session_links: CPOPackageSessionLink[];
}
