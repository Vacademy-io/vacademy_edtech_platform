import type { CommerceLocation, ManagerApproval } from '@/routes/commerce/-shared/commerce-types';

/**
 * Wire types of the inventory screens (WP-41), snake_case as the server sends
 * them (contract §3–§4). Every answer passes a normaliser in `inventory-api`
 * first: lists are never absent, numbers are numbers, and a field the server
 * leaves out is null.
 */

// ─── Runtime-key lists (each value has a string; see commerce-locales.test) ──

export const INVENTORY_TABS = ['stock', 'movements', 'receive', 'transfers', 'counts', 'low', 'labels'] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

/** Tabs that work on one place only: "All my locations" asks for one. */
export const ONE_LOCATION_TABS: readonly InventoryTab[] = ['receive', 'low', 'labels'];

export const SHORTFALL_REASONS = ['DAMAGED_IN_TRANSIT', 'LOST'] as const;
export type ShortfallReason = (typeof SHORTFALL_REASONS)[number];

export const REPRINT_REASONS = ['TORN', 'LOST', 'PRICE_CHANGED', 'NOT_PRINTED', 'OTHER'] as const;
export type ReprintReason = (typeof REPRINT_REASONS)[number];

export const LABEL_TEMPLATES = ['STICKER_50X25', 'A4_65'] as const;
export type LabelTemplate = (typeof LABEL_TEMPLATES)[number];

/** The language a printed label shows (owner decision: Hindi first, English small below). */
export const LABEL_LANGUAGES = ['both', 'hi', 'en'] as const;
export type LabelLanguage = (typeof LABEL_LANGUAGES)[number];

export const UNCOUNTED_CHOICES = ['SKIP', 'ZERO'] as const;
export type UncountedChoice = (typeof UNCOUNTED_CHOICES)[number];

/** Reason codes a person picks for a single correction (OPS §4). */
export const ADJUSTMENT_REASONS = ['DATA_ENTRY_ERROR', 'FOUND', 'COUNT_DIFFERENCE', 'SET_SPLIT', 'SAMPLE_OR_GIFT'] as const;
/** Reason codes for damage and loss (OPS §4). */
export const DAMAGE_REASONS = ['DAMAGED_IN_STORE', 'DAMAGED_IN_TRANSIT', 'LOST', 'THEFT', 'QUALITY_REJECT'] as const;
/** Every reason a ledger row can carry (the two lists above and the ones the system writes). */
export const MOVEMENT_REASONS = [
    ...ADJUSTMENT_REASONS,
    ...DAMAGE_REASONS,
    'OPENING',
    'RECEIPT_REVERSAL',
    'POS_VOID',
    'SHIP_UNDO',
] as const;

export const MOVEMENT_TYPES = [
    'RECEIPT',
    'ADJUSTMENT',
    'DAMAGE',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'SALE',
    'POS_SALE',
    'RETURN',
    'PURCHASE_RETURN',
] as const;

/** Receive sources shown on the Receive tab (the supplier source waits for the accounts feature). */
export const RECEIVE_SOURCES = ['OWN_SOURCE', 'OPENING', 'OTHER'] as const;
export type ReceiveSource = (typeof RECEIVE_SOURCES)[number];

export const TRANSFER_WARNINGS = ['NO_CHALLAN_SERIES', 'DESTINATION_INACTIVE', 'NEEDS_DOCUMENT'] as const;
export const TRANSFER_STATUSES = ['DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED'] as const;
export const TRANSFER_DIRECTIONS = ['ANY', 'OUT', 'IN'] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];
export const COUNT_KINDS = ['COUNT', 'RECOUNT'] as const;
export const LABEL_STATUSES = ['PENDING', 'PRINTED', 'CANCELLED'] as const;
export const LABEL_REASONS = ['NEW_RECEIPT', 'REPRINT', 'PRICE_CHANGE'] as const;
export const LABEL_SOURCES = ['STOCK_RECEIPT', 'STOCK_TRANSFER', 'MANUAL'] as const;

/** How an item is sold, on the quick add form; each maps to a unit, stock mode and scale. */
export const QUICK_ADD_KINDS = ['QUANTITY', 'PIECE', 'MEASURED'] as const;
export type QuickAddKind = (typeof QUICK_ADD_KINDS)[number];

// ─── Places ──────────────────────────────────────────────────────────────────

/** A location from `GET /locations` with `assigned` for the caller (fact 39). */
export interface InventoryLocation extends CommerceLocation {
    assigned: boolean;
}

export interface PlaceRef {
    id: string;
    code: string | null;
    name: string | null;
    gstin: string | null;
}

export interface Approver {
    user_id: string;
    full_name: string;
}

// ─── Items ───────────────────────────────────────────────────────────────────

/** The common item facts every row carries for display. */
export interface ItemFacts {
    package_session_id: string;
    sku: string | null;
    product_name: string | null;
    variant_name: string | null;
    stock_mode: string | null;
    unit: string | null;
    qty_scale: number;
}

/** `GET /stock/variants` (contract §3.3): the item picker of stock staff. */
export interface VariantPick extends ItemFacts {
    product_id: string | null;
    names: { hi: string | null; en: string | null };
    status: string | null;
    stock_policy: string | null;
    qty_step: number;
    label_code: string | null;
    barcode: string | null;
    on_hand: number | null;
}

// ─── Stock and low stock ─────────────────────────────────────────────────────

export interface OverviewLevel {
    location_id: string;
    on_hand: number;
    reorder_level: number | null;
    low: boolean;
}

export interface OverviewRow extends ItemFacts {
    product_id: string | null;
    label_code: string | null;
    levels: OverviewLevel[];
    in_transit: number;
    held_online: number;
    sellable_online: number | null;
}

export interface OverviewPage {
    locations: PlaceRef[];
    rows: OverviewRow[];
    page: number;
    size: number;
    total: number;
}

export type OverviewFilter = 'ALL' | 'LOW' | 'OUT';

export interface LowRow extends ItemFacts {
    location_id: string | null;
    on_hand: number;
    reorder_level: number | null;
    shortage: number;
    last_sale_at: string | null;
    elsewhere: { location_id: string; location_name: string | null; on_hand: number }[];
    online_on_hand: number | null;
    held_online: number | null;
    sellable_online: number | null;
}

export type LowKind = 'REORDER' | 'OUT_ONLINE';

export interface ListPage<T> {
    rows: T[];
    page: number;
    size: number;
    total: number;
}

// ─── Movements ───────────────────────────────────────────────────────────────

export interface MovementReference {
    type: string | null;
    id: string | null;
    label: string | null;
    order_id: string | null;
}

export interface MovementRow extends ItemFacts {
    id: string;
    location_id: string | null;
    piece_id: string | null;
    piece_code: string | null;
    type: string;
    quantity_delta: number;
    balance_after: number | null;
    reference_type: string | null;
    reference_id: string | null;
    transfer_id: string | null;
    reference: MovementReference | null;
    reason: string | null;
    note: string | null;
    actor_user_id: string | null;
    created_at: string | null;
    unit_cost: number | null;
}

export interface MovementFilters {
    locationId?: string;
    packageSessionId?: string;
    type?: string;
    from?: string;
    to?: string;
    page: number;
    size: number;
}

// ─── Receipts ────────────────────────────────────────────────────────────────

export interface ReceiptPiece {
    id: string;
    code: string;
    status: string | null;
    unit_cost: number | null;
}

export interface ReceiptLine extends ItemFacts {
    id: string;
    qty_received: number;
    note: string | null;
    unit_cost: number | null;
    cost_source: string | null;
    pieces: ReceiptPiece[];
}

export interface ReceiptView {
    id: string;
    receipt_number: string | null;
    location_id: string | null;
    source_kind: string | null;
    source_location_id: string | null;
    received_date: string | null;
    status: string | null;
    bill_status: string | null;
    note: string | null;
    received_by: string | null;
    posted_at: string | null;
    reversed_at: string | null;
    lines: ReceiptLine[];
}

export interface ReceiptBody {
    client_request_id: string;
    location_id: string;
    source_kind: ReceiveSource;
    source_location_id?: string;
    note?: string;
    lines: { package_session_id: string; quantity: number }[];
}

export interface QuickAddBody {
    client_request_id: string;
    name: { hi?: string; en?: string };
    tax_class_id?: string;
    unit: string;
    stock_mode: 'QUANTITY' | 'PIECE';
    qty_scale: number;
    sku?: string;
    barcode?: string;
}

export interface QuickAddAnswer {
    product_id: string | null;
    package_session_id: string;
    sku: string | null;
    name: string | null;
    stock_mode: string | null;
    unit: string | null;
    qty_scale: number;
    status: string | null;
}

export interface AdjustBody {
    client_request_id: string;
    location_id: string;
    package_session_id: string;
    piece_id?: string;
    kind: 'ADJUSTMENT' | 'DAMAGE';
    quantity_delta: number;
    reason: string;
    note?: string;
    /** Flat approval fields of the existing adjustment route (fact 13). */
    approver_user_id?: string;
    approver_pin?: string;
}

// ─── Transfers ───────────────────────────────────────────────────────────────

export interface TransferRow {
    id: string;
    transfer_number: string | null;
    status: string;
    from: PlaceRef | null;
    to: PlaceRef | null;
    document_number: string | null;
    line_count: number;
    /** Base units summed over the lines: read with `qty_scale` and `unit` only when every line shares them. */
    qty_sent: number;
    /** The unit every line shares (a measured item's code, e.g. MTR); absent for pieces or mixed units. */
    unit?: string | null;
    /** The scale every line shares (1 for pieces); absent when the lines mix units. */
    qty_scale?: number | null;
    /** True when the lines mix units or scales: their base units do not add up to one figure. */
    mixed_units?: boolean;
    created_at: string | null;
    dispatched_at: string | null;
    received_at: string | null;
    overdue: boolean;
}

export interface TransferLine extends ItemFacts {
    id: string;
    item_name: string | null;
    piece_id: string | null;
    piece_code: string | null;
    qty_sent: number;
    qty_received: number | null;
    shortfall_reason: string | null;
    unit_value: number | null;
    line_value: number | null;
    hsn_code: string | null;
}

export interface TransferView {
    id: string;
    transfer_number: string | null;
    status: string;
    from: PlaceRef | null;
    to: PlaceRef | null;
    gstin_differs: boolean;
    document_type: string | null;
    document_number: string | null;
    document_date: string | null;
    eway_bill_no: string | null;
    note: string | null;
    receive_note: string | null;
    created_at: string | null;
    dispatched_at: string | null;
    received_at: string | null;
    cancelled_at: string | null;
    lines: TransferLine[];
    totals: { qty_sent: number; qty_received: number; value: number | null };
    overdue: boolean;
    warnings: string[];
    next_actions: string[];
    sellable_shortfall: { package_session_id: string; units: number }[];
    replayed: boolean;
}

/** One line as the draft editor sends it (`{package_session_id, quantity}` or `{piece_id}`). */
export type TransferLineBody = { package_session_id: string; quantity: number } | { piece_id: string };

export interface TransferCreateBody {
    client_request_id: string;
    from_location_id: string;
    to_location_id: string;
    note?: string;
    lines: TransferLineBody[];
}

export interface TransferUpdateBody {
    client_request_id: string;
    note?: string;
    lines: TransferLineBody[];
}

export interface DispatchBody {
    client_request_id: string;
    eway_bill_no?: string;
    document_type?: 'DELIVERY_CHALLAN' | 'EXTERNAL_INVOICE';
    document_number?: string;
    confirm_promised_online?: boolean;
}

export interface ReceiveTransferBody {
    client_request_id: string;
    lines: { line_id: string; qty_received: number; shortfall_reason?: ShortfallReason }[];
    note?: string;
    approval?: ManagerApproval;
}

export interface ChallanSeries {
    id: string;
    prefix: string | null;
    location_id: string | null;
    financial_year: string | null;
    status: string | null;
    next_number_preview: string | null;
}

// ─── Counts ──────────────────────────────────────────────────────────────────

export interface CountRow {
    id: string;
    /** What the caller may do (e.g. RECOUNT), from the server; null only when an older server leaves it out. */
    next_actions: string[] | null;
    count_number: string | null;
    kind: string;
    status: string;
    location: { id: string; name: string | null } | null;
    scope_collection: { id: string; name: string | null } | null;
    started_by: string | null;
    started_at: string | null;
    posted_at: string | null;
    line_count: number;
    recount_of_count_id: string | null;
}

export interface CountLine extends ItemFacts {
    id: string;
    item_name: string | null;
    piece_id: string | null;
    piece_code: string | null;
    counted_qty: number;
    counted_at: string | null;
    counted_by: string | null;
}

export interface Agreement {
    compared: number;
    agreeing: number;
    percent: number;
    passes: boolean;
}

export interface CountView extends CountRow {
    recount: { id: string; status: string; agreement: Agreement | null } | null;
    note: string | null;
    posted_by: string | null;
    uncounted_choice: string | null;
    summary: Record<string, unknown> | null;
    lines: CountLine[];
}

/** Review line flags: changed while counted (L4), accepted by a manager, a large measured difference (L7). */
export const REVIEW_LINE_FLAGS = ['NEEDS_RECOUNT', 'RECOUNT_ACCEPTED', 'MEASURED_CONFIRM'] as const;
export type ReviewLineFlag = (typeof REVIEW_LINE_FLAGS)[number];

export interface ReviewLine {
    line_id: string;
    package_session_id: string;
    sku: string | null;
    item_name: string | null;
    variant_name: string | null;
    stock_mode: string | null;
    piece_code: string | null;
    counted_qty: number;
    counted_at: string | null;
    on_hand_now: number;
    moved_since: number;
    expected_at_count: number;
    adjustment: number;
    value: number | null;
    unit: string | null;
    qty_scale: number;
    first_counted_at: string | null;
    /** Units that moved here between the first and the last save of the line. */
    moved_while_counting: number;
    /** Units packed in parcels (not on the shelf) when the line was counted. */
    packed_unshipped: number;
    flags: string[];
    accepted_by: string | null;
}

export interface UncountedItem {
    package_session_id: string;
    sku: string | null;
    item_name: string | null;
    variant_name: string | null;
    unit: string | null;
    qty_scale: number;
    on_hand_now: number;
}

export interface ReviewPiece {
    piece_id: string;
    code: string | null;
    sku: string | null;
    item_name: string | null;
    status: string | null;
    location_name: string | null;
}

export const REVIEW_PIECE_GROUPS = [
    'missing_pieces',
    'found_pieces',
    'misplaced_pieces',
    'not_in_stock_pieces',
    'reserved_not_counted',
    'arrived_during_count',
] as const;
export type ReviewPieceGroup = (typeof REVIEW_PIECE_GROUPS)[number];

export interface CountReview {
    count_id: string;
    as_of: string | null;
    lines: ReviewLine[];
    uncounted: UncountedItem[];
    pieces: Record<ReviewPieceGroup, ReviewPiece[]>;
    totals: {
        lines_with_difference: number;
        units_up: number;
        units_down: number;
        value_up: number | null;
        value_down: number | null;
    };
    needs_approval: boolean;
    /** Lines changed while they were counted, not yet counted again or accepted: Post is refused. */
    needs_recount: number;
    /** A measured item differs by more than the shop's limit: a manager confirms on Post. */
    measured_confirm: boolean;
    /** A hash of the count's lines as reviewed; a post that sends it is refused (`COUNT_CHANGED`) if lines changed since. */
    fingerprint: string | null;
    /** What "set to zero" writes off as reviewed (items' stock here, pieces nobody scanned); a ZERO post sends it back. */
    zero_write_off: ZeroWriteOff | null;
}

/**
 * Uncounted stock "set to zero" writes off: package_session_id → units, piece ids, and the
 * units of each item that had come in since the count started (stock that comes in later is
 * never written off under this review).
 */
export interface ZeroWriteOff {
    items: Record<string, number>;
    pieces: string[];
    incoming: Record<string, number>;
}

/** A line change the count sheet sends (`PUT …/lines`). */
export type CountLineBody =
    | { package_session_id: string; mode: 'SET' | 'ADD'; quantity: number; explicit_quantity?: true }
    | { piece_code: string }
    | { piece_id: string };

// ─── Labels ──────────────────────────────────────────────────────────────────

export interface LabelRow {
    id: string;
    location_id: string | null;
    package_session_id: string;
    sku: string | null;
    item_name: string | null;
    variant_name: string | null;
    piece_id: string | null;
    piece_code: string | null;
    label_code: string | null;
    quantity: number;
    reason: string | null;
    reprint_reason: string | null;
    note: string | null;
    source_type: string | null;
    source_id: string | null;
    source_label: string | null;
    status: string;
    created_at: string | null;
    printed_at: string | null;
    has_price: boolean;
    /** Labels the row was queued with (`quantity` is what still waits while it prints in rounds). */
    original_quantity: number;
    /** Labels of the row already printed (earlier rounds, or all once PRINTED). */
    printed_quantity: number;
    stock_mode: string | null;
    unit: string | null;
    qty_scale: number;
}

export interface ToReplaceRow {
    package_session_id: string;
    sku: string | null;
    item_name: string | null;
    printed_mrp: number | null;
    current_mrp: number | null;
    on_hand: number;
    stock_mode: string | null;
    unit: string | null;
    qty_scale: number;
    has_price: boolean;
    /** Labels to queue: pieces here (PIECE), 1 per roll (measured), on hand capped at 500 (quantity). */
    labels: number;
    /** `labels` was cut to the cap. */
    capped: boolean;
}

/** `POST /labels/print-data`: what the browser draws (owner decision 2026-11-18, labels printed from the browser). */
export interface LabelPrintDataBody {
    request_ids?: string[];
    receipt_id?: string;
    size: LabelTemplate;
}

export interface TextPair {
    en: string | null;
    hi: string | null;
}

/** One label as the server describes it; `copies` of it are printed. */
export interface PrintLabel {
    request_id: string | null;
    code: string;
    qr_value: string;
    product_name: TextPair;
    variant_name: TextPair;
    /** MRP (else the price) per display unit, tax included; null when the item has none. */
    price: number | null;
    currency: string;
    unit: string | null;
    sku: string | null;
    copies: number;
}

export interface SkippedLabel {
    request_id: string;
    sku: string | null;
    reason: string;
}

/** Labels of a row that did not fit one print (at most 500 at once): `copies` of them still wait. */
export interface LeftOutLabel {
    request_id: string;
    sku: string | null;
    copies: number;
}

export interface LabelPrintData {
    shop_name: string | null;
    labels: PrintLabel[];
    /** Rows not drawn (an item without a price): they stay waiting. */
    skipped: SkippedLabel[];
    total_copies: number;
    /** Rows drawn in part or not at all because one print takes at most 500 labels: they wait for the next print. */
    left_out: LeftOutLabel[];
    left_out_copies: number;
}

export type LabelRequestLine = { package_session_id: string; quantity: number } | { piece_id: string } | { piece_code: string };

export interface LabelRequestBody {
    client_request_id: string;
    location_id: string;
    reason: 'REPRINT' | 'PRICE_CHANGE';
    reprint_reason?: ReprintReason;
    note?: string;
    lines: LabelRequestLine[];
}

// ─── Opening stock (WP-53) ───────────────────────────────────────────────────

/** Where a location stands with its opening stock, in order. */
export const OPENING_STATUSES = ['NOT_STARTED', 'RECEIVING', 'COUNTING', 'RECOUNT_FAILED', 'PASSED'] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];

export const OPENING_BLOCKERS = [
    'COSTS_MISSING',
    'UNCOSTED_OPENING_RECEIPT',
    'SAMPLE_TOO_SMALL',
    'AGREEMENT_BELOW_98',
    'COUNT_NOT_POSTED',
] as const;
export type OpeningBlocker = (typeof OPENING_BLOCKERS)[number];

export interface OpeningUncostedReceipt {
    id: string;
    receipt_number: string | null;
    received_date: string | null;
    lines: number;
    units: number;
}

export interface OpeningRecount {
    recount_id: string;
    recount_number: string | null;
    count_id: string | null;
    count_number: string | null;
    main_lines: number;
    compared: number;
    agreeing: number;
    percent: number;
    sample_percent: number;
    sample_needed: number;
    sample_ok: boolean;
    agreement_ok: boolean;
    passes: boolean;
}

/** `GET /stock/opening/readiness?locationId=`. `value` is null for those who do not see cost. */
export interface OpeningReadiness {
    location_id: string;
    status: OpeningStatus;
    ready: boolean;
    blockers: OpeningBlocker[];
    /** The location's goods; `institute_without_cost` counts the whole shop, for information. */
    items: {
        tracked: number;
        with_cost: number;
        without_cost: number;
        without_cost_skus: string[];
        untracked: number;
        institute_without_cost?: number;
    };
    receipts: {
        count: number;
        lines: number;
        units: number;
        units_costed: number;
        value: number | null;
        uncosted_receipts: OpeningUncostedReceipt[];
    };
    recount: OpeningRecount | null;
    sees_cost: boolean;
}
