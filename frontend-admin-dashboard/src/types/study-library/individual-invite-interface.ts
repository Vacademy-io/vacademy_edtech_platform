interface CustomField {
    guestId: string;
    id: string;
    fieldKey: string;
    fieldName: string;
    fieldType: string;
    defaultValue: string;
    config: string;
    formOrder: number;
    isMandatory: boolean;
    isFilter: boolean;
    isSortable: boolean;
    createdAt: string; // ISO date string
    updatedAt: string; // ISO date string
    sessionId: string;
    liveSessionId: string;
    customFieldValue: string;
}

interface InstituteCustomField {
    id: string;
    institute_id: string;
    type: string;
    type_id: string;
    /**
     * Per-form required-ness, written by this invite's own Required switch. Takes precedence
     * over `custom_field.isMandatory`, which is the master row shared with every other form
     * that uses the same field.
     */
    is_mandatory?: boolean | null;
    custom_field: CustomField;
}

interface ReferralOption {
    id: string;
    name: string;
    status: string;
    source: string;
    source_id: string;
    referrer_discount_json: string;
    referee_discount_json: string;
    referrer_vesting_days: number;
    tag: string;
    description: string;
    created_at: string; // ISO date string
    updated_at: string; // ISO date string
}

interface PaymentPlan {
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
    referral_option: ReferralOption;
}

interface PaymentOption {
    id: string;
    name: string;
    status: string;
    source: string;
    source_id: string;
    tag: string;
    type: string;
    require_approval: boolean;
    payment_plans: PaymentPlan[];
    payment_option_metadata_json: string;
}

interface PackageSessionToPaymentOption {
    package_session_id: string;
    id: string;
    payment_option: PaymentOption;
}

export interface IndividualInviteLinkDetails {
    id: string;
    name: string;
    start_date: string; // ISO date string
    end_date: string; // ISO date string
    invite_code: string;
    status: string;
    institute_id: string;
    vendor: string;
    vendor_id: string;
    currency: string;
    tag: string;
    learner_access_days: number;
    web_page_meta_data_json: string;
    setting_json: string;
    institute_custom_fields: InstituteCustomField[];
    package_session_to_payment_options: PackageSessionToPaymentOption[];
}
