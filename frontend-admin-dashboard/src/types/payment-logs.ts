export interface PaymentLog {
    id: string;
    status: string;
    /** VOIDED: an admin voided a payment recorded by mistake (listing reports it as CANCELLED). */
    payment_status: 'PAID' | 'FAILED' | 'PAYMENT_PENDING' | 'VOIDED' | null;
    user_id: string;
    vendor: string;
    vendor_id: string;
    /** DATE column — no time component (serialized as UTC midnight). Use `created_at` for time. */
    date: string;
    /** Real payment timestamp (UTC, with offset). Absent on very old API builds. */
    created_at?: string | null;
    currency: string;
    payment_amount: number;
    payment_specific_data: string | null;
    transaction_id?: string;
    tracking_id?: string | null;
    tracking_source?: string | null;
    order_status?: string | null;
    /** Offline payments only: how it was paid, as recorded by an admin (V577). */
    payment_mode?: string | null;
    payment_sub_mode?: string | null;
    payment_reference?: string | null;
    /** JSON: mode_label, sub_mode_label, notes, proof_file_id, cheque_date, bank_name, payer_name. */
    payment_details_json?: string | null;
    recorded_by_user_id?: string | null;
}

export interface EnrollInvite {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    invite_code: string;
    status: string;
    institute_id: string;
    vendor: string;
    vendor_id: string;
    currency: string;
    tag: string;
    learner_access_days: number | null;
    web_page_meta_data_json: string;
    is_bundled: boolean;
    institute_custom_fields: string | null;
    package_session_to_payment_options: string | null;
    setting_json: string;
}

export interface PaymentOption {
    id: string;
    name: string;
    status: string;
    source: string;
    source_id: string;
    tag: string | null;
    type: string;
    require_approval: boolean;
    unit: string | null;
    payment_plans: string | null;
    payment_option_metadata_json: string;
}

export interface PaymentPlanDto {
    id: string;
    name: string;
    status: string;
    validity_in_days: number;
    actual_price: number;
    elevated_price: number;
    currency: string;
    description: string;
    tag: string;
    feature_json: string;
    referral_option: string | null;
    referral_option_smapping_status: string | null;
}

export interface User {
    id: string;
    username: string;
    email: string;
    full_name: string;
    address_line: string;
    city: string;
    region: string | null;
    pin_code: string;
    mobile_number: string;
    date_of_birth: string | null;
    gender: string;
    password: string | null;
    profile_pic_file_id: string | null;
    roles: string[];
    last_login_time: string | null;
    root_user: boolean;
}

export interface UserPlan {
    id: string;
    user_id: string;
    payment_plan_id: string;
    plan_json: string | null;
    applied_coupon_discount_id: string | null;
    applied_coupon_discount_json: string | null;
    enroll_invite_id: string;
    payment_option_id: string;
    payment_option_json: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    payment_logs: string | null;
    enroll_invite: EnrollInvite;
    payment_option: PaymentOption;
    payment_plan_dto: PaymentPlanDto;
    // New fields for source and subOrg details
    source?: 'USER' | 'SUB_ORG';
    sub_org_id?: string | null;
    sub_org_details?: {
        id: string;
        name: string;
        address: string;
    } | null;
}

export interface PaymentLogEntry {
    payment_log: PaymentLog;
    /** Null on rows that ARE an invoice rather than a payment — those have no plan. */
    user_plan: UserPlan;
    /**
     * PAID | FAILED | PAYMENT_PENDING | NOT_INITIATED; ABANDONED for a PAYMENT_PENDING row too
     * old to complete (server-derived, never persisted); or CANCELLED for a voided invoice —
     * which is shown but never counted toward collected or due.
     */
    current_payment_status:
        | 'PAID'
        | 'FAILED'
        | 'PAYMENT_PENDING'
        | 'NOT_INITIATED'
        | 'ABANDONED'
        | 'CANCELLED'
        | string;
    user: User;
    /**
     * Set only when this row IS an invoice that has been raised but never paid against (no
     * payment log exists yet). Payment-backed rows leave this null and get their invoice from
     * the separate bulk lookup.
     */
    invoice?: PaymentLogInvoiceRow | null;
    /**
     * When the learner joined the batch this payment's plan is for — the stored enrolled_date
     * ("2026-09-28"), shown on renewal attempts too. Null for invoice rows and for someone never
     * enrolled there.
     */
    enrolled_date?: string | null;
    /**
     * When the plan's next payment falls due: a plain day for an instalment or an unpaid invoice,
     * or a UTC instant for a subscription renewal. Null when nothing is due (plan not active,
     * one-time or free, or fully paid). Read it with parsePlanDate.
     */
    next_due_on?: string | null;
}

/** The invoice carried inline on an invoice-backed row. Mirrors PaymentLogInvoiceDTO. */
export interface PaymentLogInvoiceRow {
    payment_log_id: string;
    invoice_id: string;
    invoice_number: string;
    invoice_date: string | null;
    status: string;
    total_amount: number | null;
    currency: string | null;
    has_pdf: boolean;
}

export interface PaymentLogsResponse {
    content: PaymentLogEntry[];
    pageable: {
        pageNumber: number;
        pageSize: number;
        sort: {
            empty: boolean;
            sorted: boolean;
            unsorted: boolean;
        };
        offset: number;
        paged: boolean;
        unpaged: boolean;
    };
    totalPages: number;
    totalElements: number;
    last: boolean;
    size: number;
    number: number;
    sort: {
        empty: boolean;
        sorted: boolean;
        unsorted: boolean;
    };
    numberOfElements: number;
    first: boolean;
    empty: boolean;
}

export interface PaymentLogsRequest {
    /** Plan names to keep. Invoice rows carry no plan, so any value here drops them. */
    payment_plan_names?: string[];
    /** Which KPI tile the table is showing: total | paid | pending | abandoned | failed. */
    status_bucket?: string;
    institute_id: string;
    user_id?: string;
    start_date_in_utc?: string;
    end_date_in_utc?: string;
    payment_statuses?: string[];
    user_plan_statuses?: string[];
    enroll_invite_ids?: string[];
    package_session_ids?: string[];
    sources?: ('USER' | 'SUB_ORG')[]; // New field for filtering by source
    payment_types?: string[]; // High-level payment type filter (SUB_ORG_ADMIN, LIVE_CLASS, CPO, USER_INVOICE, ...)
    search_string?: string; // Free-text search across user name/email/phone (via auth) and amount
    sort_columns?: Record<string, string>;
    /** Fill enrolled_date / next_due_on on each row (only while those columns are shown). */
    include_plan_dates?: boolean;
}

export interface PackageSession {
    id: string;
    package_session_name: string;
    start_date: string;
    end_date?: string;
}

export interface DateRangeFilter {
    label: string;
    startDate: Date;
    endDate: Date;
}

// Institute batch for session structure
export interface BatchForSession {
    id: string; // This is the package_session_id
    level: {
        id: string;
        level_name: string;
        duration_in_days: number;
        thumbnail_id: string | null;
    };
    session: {
        id: string;
        session_name: string;
        status: string;
        start_date: string;
    };
    start_time: string | null;
    status: string;
    is_org_associated?: boolean; // New field to check if batch is org associated
    is_parent?: boolean;
    parent_id?: string | null;
    package_dto: {
        id: string;
        package_name: string;
        thumbnail_file_id: string;
        is_course_published_to_catalaouge: boolean;
        course_preview_image_media_id: string;
        course_banner_media_id: string;
        course_media_id: string;
        why_learn_html: string;
        who_should_learn_html: string;
        about_the_course_html: string;
        tags: string[];
        course_depth: number;
        course_html_description_html: string;
    };
    group: {
        id: string;
        group_name: string;
        parent_group: string | null;
        is_root: boolean | null;
        group_value: string;
    } | null;
    read_time_in_minutes: number;
}

export interface PackageSessionFilter {
    packageId?: string;
    sessionId?: string;
    levelId?: string;
    packageSessionId?: string;
    packageSessionIds?: string[];
}
