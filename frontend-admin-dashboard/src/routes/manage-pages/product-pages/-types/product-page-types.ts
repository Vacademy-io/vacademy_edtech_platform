import type { Component } from '../../-types/editor-types';

export interface PaymentPlan {
    id: string;
    name: string;
    status: string;
    validity_in_days: number;
    actual_price: number;
    elevated_price: number;
    currency: string;
    description: string;
    tag: string;
}

export interface ProductPageInviteMappingResponse {
    id: string;
    ps_invite_payment_option_id: string;
    enroll_invite_id: string;
    package_session_id: string;
    payment_option_id: string;
    payment_plan_id: string;
    payment_plan: PaymentPlan;
    preselected: boolean;
    display_order: number;
    status: string;
    /** Sent by the backend; used to author basket-pricing groups and combos. */
    package_name?: string | null;
    level_name?: string | null;
}

export interface ProductPageAggregatedField {
    field: {
        /** InstituteCustomField PK */
        id: string;
        /** CustomFields PK — used as the customFieldId for add/remove API calls */
        field_id: string;
        /** CustomFieldDTO serializes camelCase (no @JsonNaming on that class) */
        custom_field: {
            id: string;
            fieldKey: string;
            fieldName: string;
            fieldType: string;
            isMandatory: boolean | null;
            formOrder: number | null;
            /** JSON blob: dropdown options, help text, and the verification block. */
            config?: string | null;
        } | null;
        is_mandatory: boolean | null;
        /** Position in this page's form. The mapping's answer, so it beats the
         *  custom field's own institute-wide `formOrder`. Null on fields nobody
         *  has ordered yet — they all tie and keep their arrival order. */
        individual_order?: number | null;
    };
    enroll_invite_ids: string[];
}

export interface ProductPageResponse {
    id: string;
    name: string;
    code: string;
    institute_id: string;
    status: string;
    page_json: string | null;
    settings_json: string | null;
    short_url: string | null;
    mappings: ProductPageInviteMappingResponse[];
    aggregated_custom_fields: ProductPageAggregatedField[];
    vendor: string | null;
    currency: string | null;
    gtm_container_id: string | null;
}

/** One card of the admin list: GET /product-page/list. No page JSON or mappings. */
export interface ProductPageSummary {
    id: string;
    name: string;
    code: string;
    status: string;
    short_url: string | null;
    mapping_count: number;
    created_at: string | null;
    updated_at: string | null;
}

export type ProductPageListStatus = 'ALL' | 'ACTIVE' | 'DRAFT';
export type ProductPageListSort = 'LATEST' | 'OLDEST' | 'NAME_ASC' | 'NAME_DESC';

/**
 * total_elements / total_pages count every filter; active_count and
 * draft_count follow the search only, so the status chips keep their numbers
 * while one is selected.
 */
export interface ProductPageListResponse {
    content: ProductPageSummary[];
    page: number;
    size: number;
    total_elements: number;
    total_pages: number;
    active_count: number;
    draft_count: number;
}

export interface ProductPageInviteMappingRequest {
    ps_invite_payment_option_id: string;
    payment_plan_id: string;
    preselected: boolean;
    display_order: number;
}

export interface ProductPageRequest {
    name: string;
    page_json?: string;
    settings_json?: string;
    status: string;
    mappings: ProductPageInviteMappingRequest[];
}

export interface BasketPricingGroup {
    label: string;
    /** Level names in this group — the basket is split and priced per group. */
    levels: string[];
    /** Price for taking EVERY level in this group. Exact, so it survives the
     *  class gaining or losing a subject. */
    packPrice?: number;
}

export interface BasketPricingCombo {
    label: string;
    /** Course names that must be selected EXACTLY, within one group. */
    packages: string[];
    price: number;
}

/**
 * Prices the basket as a whole instead of adding up per-course prices, for
 * catalogues that sell "any 3 for X". See BasketPricingCalculator.java — the
 * server recomputes this at checkout and is the authority.
 */
export interface BasketPricingTier {
    /** Applies once the basket reaches this many courses. */
    minCourses?: number;
    /** Applies once the courses cost at least this much. */
    minAmount?: number;
    /** Closes the band at the top. Absent or zero means open-ended. */
    maxAmount?: number;
    type: 'PERCENT' | 'AMOUNT';
    /** Percent off the course prices, or a flat currency amount. */
    value: number;
    /** Ceiling in currency for a percentage tier. Absent or zero means no cap. */
    maxDiscount?: number;
}

export interface BasketPricingSettings {
    enabled: boolean;
    /**
     * FLAT (default) reads `ladder` as absolute prices — the only thing that
     * works when the courses are free and carry no price to discount. DISCOUNT
     * reads `tiers` as a reduction off what the courses cost on their enroll
     * invites, so the per-course rate has ONE home: the payment plan.
     */
    pricingBasis?: 'FLAT' | 'DISCOUNT';
    tiers?: BasketPricingTier[];
    ladder: {
        /** Price for a basket of 1, 2, 3 … in order. */
        prices: number[];
        /** Added for each course beyond the last listed price. */
        perExtra: number;
    };
    groups?: BasketPricingGroup[];
    /**
     * Where the ladder counts. GROUP (default) prices each class on its own;
     * BASKET counts every subject together.
     */
    ladderScope?: 'GROUP' | 'BASKET';
    /** Count → price, used only when a group's selection is complete. */
    wholeGroupPrices?: Record<string, number>;
    combos?: BasketPricingCombo[];
}

export interface OfferRule {
    /** Stable id — the payment log names which offer paid out. */
    id: string;
    label: string;
    /** Cart total at or above this qualifies. Omit for no amount condition. */
    minAmount?: number;
    /** At least this many courses. Omit for no count condition. */
    minCourses?: number;
    discountType: 'FIXED' | 'PERCENTAGE';
    discountValue: number;
    /** Ceiling for a percentage offer. */
    maxDiscount?: number;
}

/**
 * Predefined offers — no code, applied automatically, everyone sees the same
 * list. Distinct from Coupons, which are codes with their own redemption
 * limits. Only the BEST qualifying rule is applied. Server recomputes it at
 * checkout (OfferCalculator.java).
 */
export interface OffersSettings {
    enabled: boolean;
    rules: OfferRule[];
    heading?: string;
}

/**
 * One button on the learner-facing Course Finder ("Class 6", "Class 12 NEET").
 *
 * Membership is stored as package_session_ids, chosen by the admin from this
 * page's own courses. Nothing is parsed out of a course or level name: a page
 * selling one scholarship test per class carries all of them under a single
 * level with the class only in the course name, so a name-derived group would
 * reveal the whole catalogue behind every button.
 */
export interface CourseFinderGroup {
    /** Stable id — survives renaming the button. */
    id: string;
    label: string;
    /** Optional line under the label ("For CBSE & ICSE students"). */
    description?: string;
    /** package_session_ids this button reveals. */
    packageSessionIds?: string[];
    /** Level names, for pages that genuinely model a class AS a level. */
    levelNames?: string[];
}

/**
 * A "choose your class" screen shown before the course grid. Presentation
 * only — the server neither reads nor recomputes it, unlike basket pricing.
 */
export interface CourseFinderSettings {
    enabled: boolean;
    heading?: string;
    subheading?: string;
    /** Lets the visitor past the screen to the whole catalogue. Off by default. */
    allowSkip?: boolean;
    skipLabel?: string;
    /** Wording for the undo affordance above the catalogue. */
    changeLabel?: string;
    /**
     * SHOW_COURSES (default) reveals the restricted catalogue. GO_TO_FORM
     * selects the class's course and skips the cart, but only where the class
     * resolves to exactly one course.
     */
    onPick?: 'SHOW_COURSES' | 'GO_TO_FORM';
    /** Confirm-button wording. `{{class}}` becomes the label the learner picked. */
    ctaLabel?: string;
    groups: CourseFinderGroup[];
}

export interface ProductPageSettings {
    defaultStep: 'CATALOG' | 'CART' | 'PAYMENT';
    allowCourseDeselection: boolean;
    gtmContainerId?: string;
    tnc: {
        enabled: boolean;
        content: string;
        externalUrl: string;
    };
    invoice: {
        enabled: boolean;
        channels: ('EMAIL' | 'WHATSAPP')[];
    };
    suggestedCourses: {
        enabled: boolean;
        heading: string;
        showOn?: 'CART' | 'FORM' | 'BOTH';
    };
    disableBackNavigation: boolean;
    coupon: {
        enabled: boolean;
    };
    basketPricing?: BasketPricingSettings;
    courseFinder?: CourseFinderSettings;
    offers?: OffersSettings;
    afterPaymentRedirectUrl?: string;
    /** Seconds the success screen stays up before the redirect fires. */
    afterPaymentRedirectDelaySeconds?: number;
    showLoginButton?: boolean;
    successPageContent?: string;
    /** Log a buyer whose account the checkout created straight into their dashboard. */
    autoLoginAfterPayment?: boolean;
}

export const DEFAULT_PRODUCT_PAGE_SETTINGS: ProductPageSettings = {
    defaultStep: 'CATALOG',
    allowCourseDeselection: true,
    tnc: { enabled: false, content: '', externalUrl: '' },
    invoice: { enabled: true, channels: ['EMAIL'] },
    suggestedCourses: { enabled: false, heading: 'People also buy' },
    disableBackNavigation: false,
    coupon: { enabled: false },
    afterPaymentRedirectUrl: '',
    afterPaymentRedirectDelaySeconds: 3,
    showLoginButton: true,
    successPageContent: '',
    autoLoginAfterPayment: false,
};

export interface ProductPageCouponRequest {
    code: string;
    discount_type: 'PERCENTAGE' | 'FIXED';
    discount_value: number;
    max_discount_value?: number;
    max_uses?: number;
    /** Smallest cart this code may be used on. Omit for no minimum. */
    min_items?: number;
    redeem_start_date?: string;
    redeem_end_date?: string;
}

// ─── page_json — uses catalogue Component type for full reuse ─────────────────

export type { Component as PageComponent };

export interface PageJson {
    globalSettings: {
        primaryColor: string;
        logoFileId: string;
    };
    components: Component[];
    suggestions?: Record<string, string[]>;
}

export const DEFAULT_PAGE_JSON: PageJson = {
    globalSettings: { primaryColor: '#000000', logoFileId: '' },
    components: [
        {
            id: 'header-default',
            type: 'header',
            enabled: true,
            props: { logo: '', title: '', navigation: [], authLinks: [] },
        },
        {
            id: 'herosection-default',
            type: 'heroSection',
            enabled: true,
            props: {
                layout: 'split',
                backgroundColor: '#F8FAFC',
                left: {
                    title: '',
                    description: '',
                    button: { enabled: false, text: 'Enroll Now', action: 'navigate', target: '' },
                },
                right: { image: '', alt: '', imageCollage: [] },
                styles: { padding: '40px', roundedEdges: true, textAlign: 'left' },
            },
        },
        {
            id: 'productcourse-default',
            type: 'productCourseGrid',
            enabled: true,
            props: { columns: 3, showPrice: true, showBadge: true, showFilters: true },
        },
        {
            id: 'footer-default',
            type: 'footer',
            enabled: true,
            props: {
                leftSection: { title: '', text: '', socials: [] },
                rightSection1: { title: 'Quick Links', links: [] },
                bottomNote: '',
            },
        },
    ],
};

// ─── Row state used inside the editor for building/editing mappings ───────────
export interface MappingRow {
    rowId: string;
    inviteId: string;
    inviteName: string;
    psInvitePaymentOptionId: string;
    packageSessionId: string;
    paymentPlanId: string;
    paymentPlanName: string;
    paymentPlanPrice: number;
    currency: string;
    preselected: boolean;
    displayOrder: number;
    /**
     * Carried so the settings tab can offer real level / course pickers.
     * Optional: a row just added from the course picker has not been through the
     * server yet, and these are enrichment for display, never part of the save.
     */
    levelName?: string;
    packageName?: string;
}
