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
    feature_json?: string;
    /**
     * Set when the server priced this plan for the viewer's country (regional pricing):
     * actual_price / currency above are then the regional ones, and these hold the plan's
     * own price. Absent otherwise.
     */
    base_actual_price?: number | null;
    base_elevated_price?: number | null;
    base_currency?: string | null;
    pricing_country?: string | null;
}

export interface ProductPageMappingResponse {
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
    package_id?: string;
    package_name?: string;
    level_name?: string;
    session_name?: string;
    course_preview_image_media_id?: string | null;
    about_the_course_html?: string | null;
    /** Comma-separated course tags (CBSE, ICSE, …) — drives the tag filter. */
    tags?: string | null;
    payment_option_type?: string | null;
}

export interface AggregatedCustomField {
    field: {
        id: string;
        type: string;
        type_id: string;
        group_name?: string | null;
        individual_order?: number;
        is_mandatory: boolean;
        status: string;
        custom_field: {
            id: string;
            fieldKey: string;
            fieldName: string;
            fieldType: string;
            isMandatory: boolean;
            formOrder: number;
            config?: string | null;
            commaSeparatedOptions?: string | null;
            defaultValue?: string | null;
        };
    };
    enroll_invite_ids: string[];
}

/**
 * One button on the Course Finder screen — "Class 6", "Class 12 NEET".
 *
 * Membership is admin-authored and stored as ids, never derived from the
 * course or level name. Real names drift ("UnlockX Scholarship Test - Class 6",
 * "Cyber AI- Class 6", "Social Science Class - 5"), and a page whose classes
 * all share one level (every scholarship test sitting under "Scholarship Test")
 * cannot be split by name at all. `levelNames` is the shortcut for pages that
 * genuinely model a class AS a level; ids win where both are present.
 */
export interface ProductPageFinderGroup {
    /** Stable id — survives renaming the button, and keys the saved pick. */
    id: string;
    label: string;
    /** Optional line under the label ("For CBSE & ICSE students"). */
    description?: string;
    /** package_session_ids this button reveals. The authoritative matcher. */
    packageSessionIds?: string[];
    /** Level names this button reveals, for level-modelled pages. */
    levelNames?: string[];
}

/**
 * A "choose your class" screen shown BEFORE the course grid, for pages whose
 * visitors only ever want the one course meant for them. Picking a button
 * restricts the catalogue to that group's courses for the rest of the visit.
 *
 * Presentation only — no pricing or enrolment behaviour rides on it, so the
 * server neither knows nor needs to know about it.
 */
export interface ProductPageCourseFinder {
    enabled: boolean;
    /**
     * DIALOG (default) — a modal over the course grid, the same shell the
     * catalogue's CourseFinderWizard uses, so a visitor meets one finder across
     * both surfaces. FULLSCREEN — the picker replaces the page until answered,
     * for a page that is purely a funnel.
     */
    display?: 'DIALOG' | 'FULLSCREEN';
    heading?: string;
    subheading?: string;
    /** Lets the visitor past the screen to the whole catalogue. Off by default. */
    allowSkip?: boolean;
    skipLabel?: string;
    /** Wording for the undo affordance above the catalogue ("Change class"). */
    changeLabel?: string;
    /**
     * What picking a class does.
     *
     * SHOW_COURSES (default) reveals the restricted catalogue, leaving the
     * visitor to add the course themselves. GO_TO_FORM selects it and jumps
     * straight to the details step — for pages where a class resolves to
     * exactly ONE course and the cart would only ask the visitor to confirm
     * the single thing they just asked for. Safe because the details step
     * shows the order summary too (it leads, on mobile), so nothing about
     * what they are enrolling in is hidden by skipping the cart.
     *
     * A group covering several courses always falls back to SHOW_COURSES:
     * choosing among them is the visitor's decision, not the page's.
     */
    onPick?: 'SHOW_COURSES' | 'GO_TO_FORM';
    /**
     * Wording for the dialog's confirm button.
     *
     * `{{class}}` is replaced with the label the visitor picked, so a page can
     * say "Register for Class 9" rather than a fixed phrase. Left empty the
     * default follows `onPick`: a button that opens a registration form must
     * not promise to show courses.
     */
    ctaLabel?: string;
    groups: ProductPageFinderGroup[];
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
        channels: string[];
    };
    suggestedCourses?: {
        enabled: boolean;
        heading: string;
        showOn?: 'CART' | 'FORM' | 'BOTH';
    };
    disableBackNavigation?: boolean;
    /**
     * "Choose a Plan" tiles on the cart step, one per distinct payment plan
     * configured on this page's mappings (see PlanTiles). Off by default:
     * where every course carries its own plan the tiles only restate the
     * course grid, so this is for pages selling the same thing several ways
     * — single subject vs. combo vs. full pack.
     */
    planSelector?: {
        enabled: boolean;
        heading?: string;
        subheading?: string;
        /**
         * EXCLUSIVE (default) — picking a tile clears the other tiles' items,
         * leaving anything added from the course grid alone.
         * ADDITIVE — tiles stack, each one toggling its own items.
         */
        mode?: 'EXCLUSIVE' | 'ADDITIVE';
    };
    coupon?: {
        enabled: boolean;
    };
    /**
     * "Buy more, pay less": a discount that grows with how many courses the
     * basket holds. Tiers name the smallest basket they apply to and the
     * highest one reached wins. The server recomputes this at checkout
     * (BundleDiscountCalculator) — see bundle-discount.ts.
     */
    bundleDiscount?: {
        enabled: boolean;
        tiers: Array<{
            minCourses: number;
            discountType: 'PERCENTAGE' | 'FIXED';
            discountValue: number;
        }>;
        showNudge?: boolean;
    };
    afterPaymentRedirectUrl?: string;
    /** Seconds the success screen stays up before the redirect fires. */
    afterPaymentRedirectDelaySeconds?: number;
    showLoginButton?: boolean;
    successPageContent?: string;
    /**
     * Log a brand-new buyer straight into their dashboard once the payment
     * goes through. Off by default; accounts that existed before the checkout
     * still sign in themselves (the server decides who qualifies).
     */
    autoLoginAfterPayment?: boolean;
    courseFinder?: ProductPageCourseFinder;
}

export interface ProductPageData {
    id: string;
    name: string;
    code: string;
    institute_id: string;
    status: string;
    page_json: string | null;
    settings_json: string | null;
    short_url: string | null;
    mappings: ProductPageMappingResponse[];
    aggregated_custom_fields: AggregatedCustomField[];
    vendor: string | null;
    currency: string | null;
    gtm_container_id: string | null;
}

export interface ProductPageFormSubmitResponse {
    user_id: string;
    abandoned_cart_entry_ids: string[];
    message: string;
}

export interface ProductPageEnrollResponse {
    payment_log_id: string;
    user_id: string;
    user_plan_id?: string | null;
    status: string;
    message: string;
    enrolled_package_session_ids: string[];
    payment_url: string | null;
    order_id: string | null;
    razorpay_key_id: string | null;
    access_token: string | null;
    refresh_token: string | null;
    /** One-time code for autoLoginAfterPayment; swap it via exchangeProductPageLoginCode. */
    login_code?: string | null;
}

export interface ProductPageLoginCodeExchangeResponse {
    access_token: string;
    refresh_token: string;
}

export interface CouponValidateResponse {
    coupon_code_id: string;
    applied_coupon_discount_id: string;
    discount_type: 'PERCENTAGE' | 'FIXED';
    discount_value: number;
    max_discount_value: number | null;
    valid: boolean;
    message: string;
}

export type ProductPageStep = 'CATALOG' | 'CART' | 'FORM' | 'PAYMENT' | 'CPO_INSTALLMENTS' | 'SUCCESS';

// ─── page_json types ──────────────────────────────────────────────────────────
export type PageComponentType =
    | 'HeroBanner' | 'FilterBar' | 'CourseGrid' | 'TextBlock'
    | 'ImageBanner' | 'HTML' | 'Header' | 'Footer'
    | 'header' | 'footer' | 'heroSection' | 'productCourseGrid'
    | 'textBlock' | 'htmlBlock' | 'imageBlock' | 'videoEmbed'
    | 'statsHighlights' | 'testimonialSection' | 'faqSection'
    | 'ctaBanner' | 'featureGrid' | 'stepsProcess' | 'marquee';

export interface ComponentStyleLite {
    paddingTop?: string;
    paddingBottom?: string;
    paddingLeft?: string;
    paddingRight?: string;
    marginTop?: string;
    marginBottom?: string;
    backgroundColor?: string;
    borderWidth?: string;
    borderColor?: string;
    borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
    borderRadius?: string;
    boxShadow?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
    opacity?: number;
    maxWidth?: string;
    minHeight?: string;
    typography?: {
        fontSize?: string;
        fontWeight?: string;
        lineHeight?: string;
        letterSpacing?: string;
        textColor?: string;
        textAlign?: 'left' | 'center' | 'right';
    };
    animation?: {
        entrance?: {
            type: 'none' | 'fadeIn' | 'fadeInUp' | 'fadeInDown' | 'fadeInLeft' | 'fadeInRight' | 'scaleUp' | 'slideUp';
            duration?: number;
            delay?: number;
            easing?: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
        };
    };
    visibility?: {
        desktop?: boolean;
        tablet?: boolean;
        mobile?: boolean;
    };
}

export interface PageComponent {
    id: string;
    type: PageComponentType;
    enabled: boolean;
    props: Record<string, unknown>;
    style?: ComponentStyleLite;
}

export interface PageJson {
    globalSettings: { primaryColor: string; logoFileId: string };
    components: PageComponent[];
    suggestions?: Record<string, string[]>;
}

// Per-field value in the registration form
export interface FieldValue {
    id: string;        // custom_field_id
    /** field_key — the stable storage key. Prefer this over `name` when looking
     *  for the learner's own email/phone/name: labels are admin-authored and a
     *  school's "School Name" matches a search for "name" just as well as the
     *  learner's own. Optional only because older stored payloads predate it. */
    key?: string;
    name: string;      // field_name
    value: string;
    is_mandatory: boolean;
    type: string;      // field_type for render type detection
    comma_separated_options?: string;
    config?: string;
    enroll_invite_ids?: string[]; // which invites own this field — used to filter per-invite on submit
}
