// Payment plan types
export type PaymentPlanType = 'SUBSCRIPTION' | 'ONE_TIME' | 'DONATION' | 'FREE' | 'CPO';
export type PaymentPlanTag = 'DEFAULT' | 'free' | null;

export interface PaymentPlanApi {
    id?: string;
    name: string;
    status: string;
    /**
     * Days of course access the plan grants, counted from enrollment.
     * null = unlimited — the backend leaves expiry_date unset for these.
     */
    validity_in_days: number | null;
    actual_price: number;
    elevated_price: number;
    currency: string;
    description: string;
    tag: PaymentPlanTag;
    type: PaymentPlanType;
    feature_json: string;
    payment_option_metadata_json?: string;
    /**
     * Members already on another plan may switch TO this one. Only honoured when the
     * parent option's `plan_change_allowed` is also true.
     */
    plan_change_allowed?: boolean;
}

/** One regional price of a plan (GET /v1/regional-pricing/payment-option/{id}). */
export interface RegionalPriceApi {
    id: string;
    payment_plan_id: string;
    currency: string;
    /** Null = every country whose currency is `currency`. */
    country_code: string | null;
    actual_price: number;
    elevated_price: number | null;
    /** AUTO follows the base price and exchange rate; MANUAL is admin-set and never overwritten. */
    price_source: 'AUTO' | 'MANUAL';
    /** MANUAL price whose plan base price changed after it was set. */
    needs_review: boolean;
    base_price_at_compute: number | null;
    base_currency: string | null;
    fx_rate_used: number | null;
    computed_at: string | null;
}

export interface RegionalPricingPlanApi {
    payment_plan_id: string;
    name: string;
    base_actual_price: number;
    base_elevated_price: number;
    base_currency: string;
    regional_prices: RegionalPriceApi[];
}

export interface RegionalPricingConfigApi {
    payment_option_id: string;
    enabled: boolean;
    currencies: string[];
    rates_fetched_at: string | null;
    plans: RegionalPricingPlanApi[];
}

export interface RegionalPriceUpsertRequest {
    payment_plan_id: string;
    currency?: string;
    country_code?: string;
    actual_price?: number;
    elevated_price?: number;
    /** true = price this row from the exchange rate (AUTO) instead of the given price. */
    auto?: boolean;
}

export interface PaymentOptionApi {
    id: string;
    name: string;
    status: string;
    source: string;
    source_id: string;
    tag: PaymentPlanTag;
    type: PaymentPlanType;
    require_approval: boolean;
    payment_plans: PaymentPlanApi[];
    payment_option_metadata_json: string;
    /**
     * Master switch for plan change: members on another option of the same package
     * session may switch INTO this option. A plan is offered as a switch target only when
     * both this and the plan's own `plan_change_allowed` are true.
     */
    plan_change_allowed?: boolean;
    /** Populated when type='CPO'. Points at the underlying ComplexPaymentOption row. */
    complex_payment_option_id?: string;
    /** Regional (country-based) pricing switch; managed from the Regional pricing dialog. */
    regional_pricing_enabled?: boolean;
    regional_pricing_currencies?: string[];
    // Read-only provenance, server-stamped. The plan picker sorts on created_at and
    // shows who added the plan; both are absent on rows created before V507.
    created_at?: string | null;
    updated_at?: string | null;
    created_by_user_id?: string | null;
    /** Resolved from auth_service on the list endpoint; null when unknown. */
    created_by_name?: string | null;
}

export interface PaymentPlan {
    id: string;
    name: string;
    type: PaymentPlanType;
    tag: PaymentPlanTag;
    currency: string;
    isDefault: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
    features?: string[];
    validityDays?: number;
    requireApproval?: boolean;
    /** Option-level master switch for "members can switch into this option". */
    planChangeAllowed?: boolean;
    /** Option-level regional (country-based) pricing switch and its auto-priced currencies. */
    regionalPricingEnabled?: boolean;
    regionalPricingCurrencies?: string[];
}

export enum PaymentPlans {
    FREE = 'FREE',
    DONATION = 'DONATION',
    SUBSCRIPTION = 'SUBSCRIPTION',
    UPFRONT = 'ONE_TIME',
    CPO = 'CPO',
}
