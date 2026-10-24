export interface StudentFilterRequest {
    name?: string;
    statuses?: string[];
    institute_ids?: string[];
    package_session_ids?: string[];
    group_ids?: string[];
    gender?: string[];
    session_expiry_days?: number[];
    sort_columns?: Record<string, string>;
    sub_org_user_types?: string[];
    payment_statuses?: string[];
    sources?: string[];
    types?: string[];
    type?: string; // Single type filter (e.g., 'ABANDONED_CART')
    type_ids?: string[];
    destination_package_session_ids?: string[];
    level_ids?: string[];
    enroll_invite_ids?: string[];
    audience_ids?: string[];
    sub_org_ids?: string[];
    /** TRIAL and/or PAID. A learner with no plan never matches. */
    membership_types?: string[];
    /** Join-date range over ssigm.enrolled_date, inclusive, as YYYY-MM-DD. */
    start_date?: string;
    end_date?: string;
    // Dropdown custom-field filters — keyed by custom_field.id, values are the
    // selected option ids. Matches the backend's StudentListFilter.customFieldFilters
    // (Map<String, List<String>>), NOT the legacy flat customFieldId*/customFieldValues*
    // shape (that shape was never read by the backend — see useStudentFilters.tsx).
    custom_field_filters?: Record<string, string[]>;
    // Operator-aware custom-field filters (CONTAINS / IS_EMPTY / NOT_EMPTY /
    // BETWEEN / GTE / LTE). Coexists with the legacy values-IN map above.
    custom_field_typed_filters?: { field_id: string; operator?: string; values: string[] }[];
    // Campaign (UTM) attribution filter — same wire shape on every list
    // surface; see services/utm-list-filters.
    utm_filters?: import('@/services/utm-list-filters').UtmListFiltersPayload;
    [key: string]: any;
}

export interface StudentAssessmentTable {
    id: string;
    full_name: string;
    package_session_id: string;
    institute_enrollment_id: string;
    linked_institute_name: string | null;
    gender: string;
    mobile_number: string;
    email: string;
    city: string;
    state: string | null;
}

// Response types
export interface StudentTable {
    id: string;
    username: string | null;
    user_id: string;
    email: string;
    full_name: string;
    address_line: string;
    attendance_percent: number;
    referral_count: number;
    region: string | null;
    city: string;
    pin_code: string;
    mobile_number: string;
    date_of_birth: string;
    gender: string;
    fathers_name: string;
    mothers_name: string;
    father_mobile_number: string;
    father_email: string;
    mother_mobile_number: string;
    mother_email: string;
    linked_institute_name: string | null;
    created_at: string;
    updated_at: string;
    package_session_id: string;
    institute_enrollment_id: string;
    institute_enrollment_number?: string;
    status: 'ACTIVE' | 'TERMINATED' | 'INACTIVE';
    session_expiry_days: number;
    institute_id: string;
    country?: string;
    expiry_date: number;
    face_file_id: string | null;
    attempt_id?: string;
    package_id?: string;
    password?: string;
    parents_email: string;
    parents_mobile_number: string;
    parents_to_mother_email: string;
    parents_to_mother_mobile_number: string;
    billing_contact_name?: string | null;
    billing_contact_email?: string | null;
    billing_contact_role?: string | null;
    destination_package_session_id: string;
    enroll_invite_id: string;
    enroll_invite_name?: string | null;
    payment_status: string;
    /** TRIAL | PAID from user_plan.is_trial; absent when the learner has no plan. */
    membership_type?: 'TRIAL' | 'TRIAL_ENDED' | 'PAID' | null;
    /** Join date (ssigm.enrolled_date). */
    enrolled_date?: string | null;
    custom_fields: Record<string, string | null>;
    sub_org_name?: string;
    sub_org_id?: string;
    comma_separated_org_roles?: string;
    tnc_accepted?: boolean | null;
    tnc_file_id?: string | null;
    tnc_accepted_date?: string | number | null;
    // True for audience-only respondents (user filled an audience form but isn't enrolled).
    // ssigm-derived fields (status, batch, expiry, enrollment_number, etc.) come back null.
    is_audience_only?: boolean | null;
    // Every package_session_id the user is enrolled in at this institute, latest first.
    // The row's `package_session_id` is the latest one; side-view tabs that fetch
    // batch-scoped data should iterate this list to cover all enrollments.
    all_package_session_ids?: string[];
}

export interface StudentListResponse {
    content: StudentTable[];
    page_no: number;
    page_size: number;
    total_elements: number;
    total_pages: number;
    last: boolean;
    /**
     * True when the institute runs trials at all (a live invite sets TRIAL_DAYS > 0).
     * Gates the Trial/Paid badge and filter, so institutes without trial memberships
     * never see a distinction that means nothing to them.
     */
    membership_types_available?: boolean;
}

// Add this below the existing interfaces like StudentListResponse

export interface StudentCredentialsType {
    username: string;
    password: string;
}
