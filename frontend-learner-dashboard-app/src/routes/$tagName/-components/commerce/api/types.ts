/**
 * The public shop contract, field for field as admin_core serialises it (snake_case):
 * StorefrontDtos (products, categories) and CartPriceDtos (cart price, pincode). These are the
 * whole public surface; nothing here is computed in the browser.
 */

export interface Price {
    amount: number | null;
    compare_at_amount: number | null;
    currency: string | null;
    /** True when the variants differ in price ("from"). */
    from: boolean;
}

export type StockState = 'IN_STOCK' | 'LOW' | 'OUT' | 'MADE_TO_ORDER';

export interface Stock {
    state: StockState;
    /** Only for LOW, in base units. */
    left: number | null;
    purchasable: boolean;
    single_piece: boolean;
    lead_time_days: number | null;
}

export interface Rendition {
    width: number | null;
    url: string | null;
}

export interface Media {
    kind: string | null;
    url: string | null;
    alt: string | null;
    tag: string | null;
    width: number | null;
    height: number | null;
    renditions: Rendition[] | null;
    variant_id: string | null;
    position: number;
    /**
     * A still for a VIDEO, shown until the shopper taps play. Not sent by the API yet (asked
     * of the backend); without it a video slide shows the product's first photo instead.
     */
    poster_url?: string | null;
}

export interface Swatch {
    code: string;
    label: string | null;
    swatch_hex: string | null;
}

export interface ProductCard {
    id: string;
    slug: string;
    path: string;
    locale: string | null;
    name: string;
    short_description: string | null;
    brand: string | null;
    unit: string | null;
    qty_scale: number;
    qty_step: number;
    origin: string | null;
    image: Media | null;
    price: Price | null;
    stock: Stock | null;
    badges: string[] | null;
    swatches: Swatch[] | null;
    variant_count: number;
    default_variant_id: string | null;
    published_at: string | null;
}

export interface OptionValue {
    code: string;
    label: string | null;
    swatch_hex: string | null;
    position: number;
}

export interface ProductOption {
    code: string;
    name: string | null;
    kind: string | null;
    values: OptionValue[];
}

export interface Variant {
    id: string;
    sku: string | null;
    label: string | null;
    option_values: Record<string, string> | null;
    price: Price | null;
    stock: Stock | null;
    weight_grams: number | null;
    length_mm: number | null;
    width_mm: number | null;
    height_mm: number | null;
    image: Media | null;
    position: number;
}

export interface ContentBlock {
    code: string;
    /** Sanitised by the server on output. */
    html: string | null;
}

export interface Spec {
    code: string;
    name: string | null;
    values: string[] | null;
}

export interface Alternate {
    locale: string;
    path: string;
}

export interface Seo {
    title: string | null;
    description: string | null;
    canonical_path: string | null;
    alternates: Alternate[] | null;
}

export interface CollectionRef {
    slug: string;
    kind: string | null;
    name: string | null;
    path: string | null;
}

export interface ProductDetail {
    id: string;
    slug: string;
    path: string;
    locale: string | null;
    available_locales: string[] | null;
    name: string;
    short_description: string | null;
    description_html: string | null;
    content_blocks: ContentBlock[] | null;
    brand: string | null;
    unit: string | null;
    qty_scale: number;
    qty_step: number;
    stock_mode: string | null;
    origin: string | null;
    price: Price | null;
    stock: Stock | null;
    badges: string[] | null;
    media: Media[] | null;
    options: ProductOption[] | null;
    variants: Variant[] | null;
    specs: Spec[] | null;
    collections: CollectionRef[] | null;
    seo: Seo | null;
    published_at: string | null;
    updated_at: string | null;
}

export interface FacetValue {
    code: string;
    label: string | null;
    swatch_hex: string | null;
    count: number;
    selected: boolean;
}

export interface Facet {
    code: string;
    name: string | null;
    kind: string | null;
    values: FacetValue[];
}

export interface PriceBand {
    /** Exclusive; null is open. */
    from: number | null;
    /** Inclusive; null is open. */
    to: number | null;
    count: number;
}

export interface Facets {
    attributes: Facet[] | null;
    price: { min: number | null; max: number | null; bands: PriceBand[] | null } | null;
    availability: { in_stock: number; out_of_stock: number } | null;
}

export interface ProductList {
    data: ProductCard[];
    total: number;
    page: number;
    page_size: number;
    has_more: boolean;
    locale: string | null;
    facets: Facets | null;
}

export interface Suggestions {
    products: ProductCard[];
    collections: CollectionRef[];
    total: number;
    locale: string | null;
}

export interface Category {
    slug: string;
    kind: string | null;
    name: string | null;
    description: string | null;
    image_url: string | null;
    path: string | null;
    position: number;
    product_count: number;
    in_stock_count: number;
    children: Category[] | null;
}

export interface CategoryTree {
    data: Category[];
    locale: string | null;
}

/* ── cart ─────────────────────────────────────────────────────────── */

export interface CartPriceRequestLine {
    line_ref: string;
    /** The variant id; or send `sku` instead (a reorder knows only the SKU). */
    variant_id?: string;
    sku?: string;
    /** Base units. */
    quantity: number;
    /** What the cart last showed for one base unit; the server never trusts it. */
    unit_price?: number | null;
}

export interface CartPriceRequest {
    lines: CartPriceRequestLine[];
    coupon_code?: string | null;
    pincode?: string | null;
    state_code?: string | null;
    payment_method?: 'PREPAID' | 'COD';
    locale?: string;
}

export interface CartPriceLine {
    line_ref: string;
    variant_id: string;
    sku: string | null;
    slug: string | null;
    name: string | null;
    variant_label: string | null;
    quantity: number;
    qty_scale: number;
    qty_step: number;
    piece: boolean;
    unit: string | null;
    unit_price: number | null;
    compare_at_price: number | null;
    gross: number | null;
    discount: number | null;
    net: number | null;
    hsn_code: string | null;
    tax_rate_percent: number | null;
    taxable_value: number | null;
    tax_amount: number | null;
}

export type UnavailableReason =
    | 'NOT_FOUND'
    | 'NO_PRICE'
    | 'OUT_OF_STOCK'
    | 'INSUFFICIENT_STOCK'
    | 'QUANTITY_INVALID'
    | 'QUANTITY_STEP'
    | 'QUANTITY_ABOVE_MAX'
    | 'CURRENCY_MISMATCH';

export interface CartUnavailableLine {
    line_ref: string;
    variant_id: string | null;
    sku: string | null;
    reason: UnavailableReason | string;
    available_quantity: number | null;
    qty_step: number | null;
    max_quantity: number | null;
}

export interface CartChange {
    line_ref: string;
    variant_id: string | null;
    type: 'PRICE_CHANGED' | 'UNAVAILABLE' | string;
    reason: string | null;
    old_unit_price: number | null;
    new_unit_price: number | null;
}

export interface CartDiscount {
    kind: string;
    label: string | null;
    code: string | null;
    amount: number | null;
}

export interface CartShipping {
    basis: string | null;
    charge: number | null;
    charge_before_free: number | null;
    free: boolean;
    free_above: number | null;
    remaining_for_free: number | null;
}

export interface CartCod {
    eligible: boolean;
    reason: string | null;
    charge: number | null;
    max_order_value: number | null;
    total_with_cod: number | null;
    needs_staff_confirmation: boolean;
    otp_required: boolean;
    pincode_checked: boolean;
}

export interface CartTax {
    head: string | null;
    place_of_supply_state: string | null;
    place_of_supply_known: boolean;
    taxable_value: number | null;
    cgst: number | null;
    sgst: number | null;
    igst: number | null;
    cess: number | null;
    tax_amount: number | null;
}

export interface CartTotals {
    subtotal: number | null;
    discount: number | null;
    shipping: number | null;
    cod_charge: number | null;
    round_off: number | null;
    total: number | null;
    line_count: number;
}

export interface CartPrice {
    currency: string | null;
    payment_method: string | null;
    lines: CartPriceLine[];
    unavailable: CartUnavailableLine[];
    changes: CartChange[];
    discounts: CartDiscount[];
    coupon: { code: string | null; applied: boolean; reason: string | null; discount: number | null } | null;
    shipping: CartShipping | null;
    cod: CartCod | null;
    tax: CartTax | null;
    totals: CartTotals | null;
}

export interface PincodeInfo {
    pincode: string;
    city: string | null;
    state_code: string | null;
    state_name: string | null;
    state_source: string | null;
    cod_allowed: boolean;
    cod_reason: string | null;
    dispatch_promise: string | null;
}

/** GET /open/commerce/v1/q/{code}: where a printed label leads (not built in the backend yet). */
export interface ScanTarget {
    path: string | null;
    slug: string | null;
    sku: string | null;
}

export type ProductSort = 'recommended' | 'newest' | 'price_asc' | 'price_desc';

export interface ProductListParams {
    q?: string;
    collection?: string;
    filters?: Record<string, string[]>;
    priceMin?: number | null;
    priceMax?: number | null;
    /** true = only what can be bought now; undefined = everything, in stock first. */
    inStock?: boolean;
    sort?: ProductSort;
    page?: number;
    pageSize?: number;
    facets?: boolean;
}

/* ── buying: checkout, orders, shopper account (contract P2 §5) ───── */

export type BuyerIdentity = 'PHONE_OTP' | 'EMAIL' | 'EITHER';
export type PaymentMethod = 'PREPAID' | 'COD';
export type OtpPurpose = 'CHECKOUT' | 'ACCOUNT' | 'TRACK_ORDER' | 'COD';

/** GET /checkout/config: what the buying pages need to know about the shop. No secret in it. */
export interface CheckoutConfig {
    buyer_identity: BuyerIdentity | string | null;
    otp: { channel: string | null; code_length: number | null; resend_after: number | null } | null;
    bot_check: { required: boolean; site_key: string | null } | null;
    payment_methods: string[] | null;
    cod: {
        enabled: boolean;
        online: boolean;
        max_order_value: number | null;
        staff_confirm_threshold: number | null;
    } | null;
    hold_minutes: number | null;
    session_days: number | null;
    currency: string | null;
}

export interface OtpSent {
    sent: boolean;
    expires_in: number;
    resend_after: number;
}

export interface OtpVerified {
    verified_phone_token: string;
    expires_in: number;
    /** Only for CHECKOUT and ACCOUNT, and only when the shop can issue sessions. */
    shopper_session_token?: string | null;
    shopper_session_expires_at?: string | null;
    shopper_session_expires_in?: number | null;
    phone_masked?: string | null;
}

export interface CheckoutAddress {
    label?: string | null;
    name: string;
    phone: string;
    line1: string;
    line2?: string | null;
    landmark?: string | null;
    city: string;
    state_code: string;
    pincode: string;
    is_default?: boolean | null;
}

/** POST /checkout. The server prices the cart again; `expected_total` only reports a change. */
export interface CheckoutRequestBody {
    client_request_id: string;
    lines: CartPriceRequestLine[];
    coupon_code?: string | null;
    payment_method: PaymentMethod;
    expected_total: number | null;
    locale?: string;
    customer: { name: string; phone: string; email?: string | null };
    shipping_address: CheckoutAddress;
    billing_address?: CheckoutAddress | null;
    buyer_gstin?: string | null;
    customer_note?: string | null;
    gift_note?: string | null;
    marketing_consent?: boolean | null;
    save_address?: boolean | null;
    challenge_token?: string | null;
    phone_token?: string | null;
}

export interface PlacedPayment {
    vendor: string;
    gateway_order_id: string;
    key_id: string;
    amount_minor: number;
    currency: string;
}

export interface PlacedHold {
    payment_log_id: string;
    release_token: string;
    expires_at: string;
}

/** The answer to a placed order, a payment retry and a client payment confirmation. */
export interface Placed {
    order_id: string;
    order_number: string;
    status: string;
    payment_status?: string | null;
    currency?: string | null;
    total?: number | null;
    payment?: PlacedPayment | null;
    payment_retryable?: boolean;
    payment_processing?: boolean;
    hold?: PlacedHold | null;
    order_access_token?: string | null;
    order_access_token_expires_at?: string | null;
    replayed?: boolean;
}

export interface OrderLineView {
    line_ref?: string | null;
    name?: string | null;
    variant_label?: string | null;
    sku?: string | null;
    quantity: number;
    qty_scale?: number | null;
    unit?: string | null;
    unit_price?: number | null;
    compare_at_price?: number | null;
    discount?: number | null;
    line_total?: number | null;
    qty_cancelled?: number | null;
    qty_shipped?: number | null;
}

export interface OrderTotals {
    subtotal?: number | null;
    discount?: number | null;
    shipping?: number | null;
    cod_charge?: number | null;
    tax?: number | null;
    round_off?: number | null;
    total?: number | null;
    amount_paid?: number | null;
}

export interface OrderRecipient {
    name?: string | null;
    phone_masked?: string | null;
    city?: string | null;
    state_code?: string | null;
    pincode?: string | null;
}

/** One order as its buyer sees it (GET /orders/view, POST /orders/track). */
export interface OrderView {
    order_id: string;
    order_number: string;
    status: string;
    payment_status?: string | null;
    payment_method?: string | null;
    cancel_reason?: string | null;
    placed_at?: string | null;
    hold_expires_at?: string | null;
    payment_retryable?: boolean;
    payment_processing?: boolean;
    currency?: string | null;
    lines?: OrderLineView[] | null;
    totals?: OrderTotals | null;
    recipient?: OrderRecipient | null;
    timeline?: Array<{ status: string; at?: string | null }> | null;
    /** Track order only: the phone was not proved when the order was placed, so state and timeline only. */
    masked?: boolean;
}

/** A row of the buyer's order list. A masked row carries only number, status and date. */
export interface OrderSummary {
    order_id?: string | null;
    order_number: string;
    status: string;
    payment_status?: string | null;
    placed_at?: string | null;
    currency?: string | null;
    total?: number | null;
    item_count?: number | null;
    first_item_name?: string | null;
    order_access_token?: string | null;
    masked?: boolean;
}

export interface OrderPage {
    orders: OrderSummary[];
    page: number;
    page_size: number;
    total: number;
}

export interface AddressView {
    id: string;
    label?: string | null;
    name?: string | null;
    phone?: string | null;
    line1?: string | null;
    line2?: string | null;
    landmark?: string | null;
    city?: string | null;
    state_code?: string | null;
    pincode?: string | null;
    is_default?: boolean | null;
}

export interface ShopperMe {
    name: string | null;
    /** The proved phone ("91" and ten digits). Kept in memory only, never in storage. */
    phone?: string | null;
    phone_masked: string | null;
    email_masked: string | null;
    marketing_consent: boolean;
    session_expires_at: string | null;
}

/** How a /me call proves the shopper: the 7-day session, or a fresh verified-phone token. */
export type ShopperAuth = { session: string } | { phoneToken: string };
