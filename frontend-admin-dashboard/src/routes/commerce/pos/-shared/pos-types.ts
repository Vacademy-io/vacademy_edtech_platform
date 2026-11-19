/**
 * Wire types of the billing counter (POS) API, snake_case as the server sends
 * them (contract WP-42 §3–§4). Money arrives as numbers or numeric strings;
 * `pos-api` normalises every answer to numbers, so screens only meet numbers.
 * Requests send money as strings with 2 decimals.
 */

export const TENDER_MODES_POS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'] as const;
export type PosTenderMode = (typeof TENDER_MODES_POS)[number];

/** Modes that need a typed reference (UPI ref, card slip number; Q5). */
export const REFERENCE_REQUIRED_MODES: ReadonlySet<string> = new Set(['UPI', 'CARD']);

/** Notes and coins counted at close, largest first. */
export const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Actions a cashier needs a manager's PIN for (`commerce_approval.action`). */
export const POS_APPROVAL_ACTIONS = [
    'POS_DISCOUNT',
    'POS_VOID',
    'POS_TENDER_CHANGE',
    'POS_BILL_BOOK',
    'POS_CASH_REFUND',
    'POS_RETURN_OVERRIDE',
    'POS_VARIANCE',
    // Spending the credit of a return not taken at the counter in the cashier's own session (D1).
    'POS_EXCHANGE',
] as const;
export type PosApprovalAction = (typeof POS_APPROVAL_ACTIONS)[number];

export const REGISTER_SETUP_WARNINGS = [
    'NO_REGISTER_SERIES',
    'NO_CREDIT_NOTE_SERIES',
    'LOCATION_NOT_POS',
] as const;

/** Reasons a counter return can carry (the return desk's list). */
export const POS_RETURN_REASONS = [
    'DEFECTIVE',
    'WRONG_ITEM',
    'DAMAGED_IN_TRANSIT',
    'SIZE',
    'CHANGED_MIND',
    'OTHER',
] as const;

/** How a counter return is settled: money back by method, or credit for a new bill. */
export const POS_RETURN_SETTLE = ['CASH', 'UPI', 'BANK_TRANSFER', 'EXCHANGE'] as const;
export type PosReturnSettle = (typeof POS_RETURN_SETTLE)[number];

/** Remainder of an exchange credit larger than the new bill goes back as cash or UPI. */
export const EXCHANGE_REMAINDER_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER'] as const;

export type LocalText = { hi?: string | null; en?: string | null };

// ─── Registers (§3.5) ────────────────────────────────────────────────────────

export interface RegisterOpenSession {
    id: string;
    cashier_user_id: string | null;
    cashier_name: string | null;
    opened_at: string | null;
    mine: boolean;
}

export interface RegisterView {
    id: string;
    code: string;
    name: string;
    location_id: string;
    location_name: string;
    status: string;
    open_session: RegisterOpenSession | null;
    setup_warnings: string[];
}

export interface RegisterCreateBody {
    client_request_id: string;
    location_id: string;
    code: string;
    name: string;
    invoice_prefix?: string;
    invoice_next_value?: number;
}

export interface RegisterUpdateBody {
    client_request_id: string;
    name?: string;
    status?: 'ACTIVE' | 'INACTIVE';
}

// ─── Catalogue and scan (§3.6) ───────────────────────────────────────────────

export interface CatalogueItem {
    variant_id: string;
    product_id: string | null;
    sku: string | null;
    label_code: string | null;
    barcode: string | null;
    names: LocalText;
    variant_label: LocalText;
    unit: string | null;
    /** 10 = the stored quantity counts tenths (measured goods). */
    qty_scale: number;
    /** Smallest step, in stored units. */
    qty_step: number;
    stock_mode: 'PIECE' | 'QUANTITY' | string;
    tracked: boolean;
    unit_price: number;
    mrp: number | null;
    currency: string;
    /** Stored units at this register's location; null when untracked. */
    on_hand: number | null;
}

export interface PosCatalogue {
    register_id: string;
    location_id: string;
    generated_at: string | null;
    truncated: boolean;
    items: CatalogueItem[];
}

export interface ScanPiece {
    id: string;
    code: string;
    status: string;
    /** IN_STOCK at this register's location. */
    here: boolean;
}

export interface PosScanAnswer {
    kind: 'PIECE' | 'VARIANT' | string;
    item: CatalogueItem;
    piece: ScanPiece | null;
}

export interface ApproverOption {
    user_id: string;
    full_name: string;
}

export interface CustomerLookup {
    found: boolean;
    name: string | null;
}

// ─── Sessions (§3.8) ─────────────────────────────────────────────────────────

export interface CashMovementView {
    id: string;
    type: 'CASH_IN' | 'CASH_OUT' | string;
    amount: number;
    reason: string;
    actor_user_id: string | null;
    created_at: string | null;
}

export interface ModeTotal {
    mode: string;
    count: number;
    amount: number;
}

export interface TaxRow {
    rate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
}

export interface RefundTotal {
    method: string;
    count: number;
    amount: number;
}

export interface CountTotal {
    count: number;
    total: number;
}

/** The Z-report (frozen at close) and the live `summary` while open: one shape. */
export interface ZReport {
    session_id: string;
    register: { code: string; name: string };
    location: { name: string };
    cashier_user_id: string | null;
    opened_at: string | null;
    closed_at: string | null;
    opening_cash: number;
    bills: CountTotal;
    voided: CountTotal;
    discounts: number;
    by_mode: ModeTotal[];
    tax_by_rate: TaxRow[];
    /** Refunds paid (PROCESSED). */
    refunds: RefundTotal[];
    /** Refunds recorded but not paid yet (PENDING / IN_PROGRESS, e.g. a UPI refund with no reference). */
    refunds_pending: RefundTotal[];
    returns: { count: number; credit: number };
    cash_in: number;
    cash_out: number;
    expected_cash: number | null;
    counted_cash: number | null;
    variance: number | null;
    denominations: Record<string, number> | null;
    bill_book: CountTotal;
    first_invoice_number: string | null;
    last_invoice_number: string | null;
}

export type SessionNextAction = 'SELL' | 'CASH_MOVEMENT' | 'CLOSE' | 'BILL_BOOK';

export interface SessionView {
    id: string;
    status: 'OPEN' | 'CLOSED' | string;
    register: { id: string; code: string; name: string };
    location: { id: string; name: string };
    cashier_user_id: string | null;
    cashier_name: string | null;
    mine: boolean;
    opened_at: string | null;
    opening_cash: number;
    opening_note: string | null;
    previous_counted_cash: number | null;
    closed_at: string | null;
    closed_by: string | null;
    expected_cash: number | null;
    counted_cash: number | null;
    variance: number | null;
    close_note: string | null;
    denominations: Record<string, number> | null;
    cash_movements: CashMovementView[];
    summary: ZReport | null;
    z_report: ZReport | null;
    next_actions: string[];
}

export interface SessionRow {
    id: string;
    status: string;
    register_code: string;
    location_name: string;
    cashier_user_id: string | null;
    /** The cashier's name, resolved by the server (G2); null when unknown. */
    cashier_name: string | null;
    opened_at: string | null;
    closed_at: string | null;
    bills_count: number;
    bills_total: number;
    variance: number | null;
}

export interface Paged<T> {
    rows: T[];
    page: number;
    page_size: number;
    total: number;
}

export interface OpenSessionBody {
    client_request_id: string;
    register_id: string;
    opening_cash: string;
    opening_note?: string;
}

export interface CashMovementBody {
    client_request_id: string;
    type: 'CASH_IN' | 'CASH_OUT';
    amount: string;
    reason: string;
}

export interface ManagerApprovalBody {
    approver_user_id: string;
    pin: string;
    reason?: string;
}

export interface CloseSessionBody {
    client_request_id: string;
    counted_cash?: string;
    denominations?: Record<string, number>;
    note?: string;
    approval?: ManagerApprovalBody;
}

// ─── Quote and sale (§3.9, §3.10) ────────────────────────────────────────────

export interface SaleLineRequest {
    line_ref: string;
    variant_id: string;
    /** Stored (base) units. */
    quantity: number;
    piece_ids?: string[];
    line_discount?: string;
    /** The catalogue price the screen showed; the server refuses PRICE_CHANGED when it moved. */
    unit_price: string;
}

export interface BillDiscountRequest {
    kind: 'AMOUNT' | 'PERCENT';
    value: string;
    reason: string;
}

export interface SaleCustomerRequest {
    phone?: string;
    name?: string;
    buyer_gstin?: string;
    buyer_legal_name?: string;
}

export interface TenderRequest {
    mode: PosTenderMode;
    amount: string;
    reference?: string;
    cash_tendered?: string;
}

export interface QuoteRequest {
    session_id: string;
    lines: SaleLineRequest[];
    bill_discount?: BillDiscountRequest;
    /** Not in §3.9: the reason for line discounts when there is no bill discount (see pos-cart). */
    discount_reason?: string;
    customer?: SaleCustomerRequest;
    exchange?: { return_id: string };
    /**
     * Quote only: price the bill as the bill-book entry will (a paper bill is keyed in as cut by
     * hand, so the sale step is not applied). The server refuses it on a sale.
     */
    paper_bill?: boolean;
}

export interface SaleRequest extends QuoteRequest {
    client_request_id?: string;
    tenders: TenderRequest[];
    exchange?: {
        return_id: string;
        remainder_refund?: { method: string; reference: string | null };
    };
    approval?: ManagerApprovalBody;
    notify: boolean;
}

export interface BillBookRequest extends SaleRequest {
    book_number: string;
    document_date: string;
}

export interface QuoteLine {
    line_ref: string;
    variant_id: string;
    quantity: number;
    unit_price: number;
    gross: number;
    discount: number;
    net: number;
    taxable_value: number;
    tax_rate: number | null;
    tax_amount: number;
}

export interface QuoteTotals {
    subtotal: number;
    discount: number;
    tax: number;
    round_off: number;
    total: number;
}

export interface Quote {
    lines: QuoteLine[];
    unavailable: { line_ref: string; reason: string }[];
    /**
     * Server: `{line_ref, variant_id, type, reason, old_unit_price, new_unit_price}`; `type` PRICE_CHANGED
     * carries the price the sale will charge (`unit_price` here = `new_unit_price`).
     */
    changes: { line_ref: string; type: string | null; unit_price: number | null }[];
    totals: QuoteTotals;
    tax_rows: TaxRow[];
    discount_percent: number | null;
    cashier_discount_percent: number | null;
    needs_approval: string[];
    exchange_credit: number | null;
}

export interface SaleDetailLine {
    order_line_id: string;
    line_no: number;
    variant_id: string;
    sku: string | null;
    name: string;
    variant_label: string | null;
    unit: string | null;
    qty_scale: number;
    quantity: number;
    unit_price: number;
    mrp: number | null;
    discount: number;
    taxable_value: number;
    tax_rate: number | null;
    tax_amount: number;
    line_total: number;
    piece_ids: string[];
    piece_codes: string[];
    qty_returned: number;
    returnable: number;
}

export interface SaleTender {
    id: string;
    mode: string;
    amount: number;
    reference: string | null;
    status: string;
    cash_tendered: number | null;
}

export interface SaleDetail {
    order_id: string;
    order_number: string;
    channel: string;
    status: string;
    session_id: string | null;
    register_id: string | null;
    location_id: string | null;
    document: { id: string | null; number: string | null; type: string | null; date: string | null; cancelled: boolean } | null;
    customer: { name: string | null; phone_last4: string | null; buyer_gstin: string | null } | null;
    lines: SaleDetailLine[];
    totals: QuoteTotals & { amount_paid: number; amount_refunded: number };
    tenders: SaleTender[];
    change_due: number | null;
    returns: { id: string; number: string | null; status: string; credit: number }[];
    next_actions: string[];
}

export interface SaleRow {
    order_id: string;
    order_number: string;
    channel: string;
    status: string;
    invoice_number: string | null;
    document_date: string | null;
    location_name: string | null;
    total: number;
    customer_name: string | null;
    phone_last4: string | null;
    /** Not in the §4.3 row; read when the server sends it (bills list "time" column). */
    created_at: string | null;
    /** Server `tender_modes` (B1 addition to the §4.3 row): the bills list "paid by" column. */
    modes: string[];
}

// ─── Receipt (§3.11) ─────────────────────────────────────────────────────────

export interface ReceiptLine {
    name: string;
    variant_label: string | null;
    quantity: number;
    qty_scale: number;
    unit: string | null;
    unit_price: number;
    discount: number;
    net: number;
    hsn_code: string | null;
    tax_rate: number | null;
}

export interface Receipt {
    shop: {
        trade_name: string | null;
        legal_name: string | null;
        gstin: string | null;
        address_lines: string[];
        phone: string | null;
    };
    location: { name: string | null; state_code: string | null };
    register: { code: string | null; name: string | null };
    document: {
        type: string | null;
        number: string | null;
        date: string | null;
        issued_at: string | null;
        cancelled: boolean;
        cancel_reason: string | null;
        paper: boolean;
    };
    order_number: string | null;
    customer: {
        name: string | null;
        phone_last4: string | null;
        buyer_gstin: string | null;
        buyer_legal_name: string | null;
    };
    lines: ReceiptLine[];
    tax_rows: TaxRow[];
    totals: QuoteTotals;
    amount_in_words: string | null;
    tenders: { mode: string; amount: number; reference: string | null; status: string }[];
    cash_tendered: number | null;
    change: number | null;
    qr_text: string | null;
}

export interface SaleAnswer {
    sale: SaleDetail;
    receipt: Receipt;
    replayed: boolean;
}

export interface VoidBody {
    client_request_id: string;
    reason: string;
    approval?: ManagerApprovalBody;
}

export interface TenderChangeBody {
    client_request_id: string;
    mode: PosTenderMode;
    reference?: string;
    approval?: ManagerApprovalBody;
}

// ─── Counter returns (§4.4) ──────────────────────────────────────────────────

export interface PosReturnLineRequest {
    order_line_id: string;
    quantity: number;
    condition?: 'RESALEABLE' | 'DAMAGED';
    piece_ids?: string[];
}

/** `POST /pos/returns/preview`: reason and settle are optional (B2: without a reason the policy's reason check is skipped). */
export interface PosReturnPreviewRequest {
    session_id: string;
    order_id: string;
    lines: Pick<PosReturnLineRequest, 'order_line_id' | 'quantity'>[];
    reason?: string;
    settle?: PosReturnBody['settle'];
}

export interface PosReturnPreview {
    returnable: { order_line_id: string; returnable: number }[];
    warnings: string[];
    credit_estimate: number | null;
    needs_approval: string[];
}

export interface PosReturnBody {
    client_request_id: string;
    session_id: string;
    order_id: string;
    lines: PosReturnLineRequest[];
    reason: string;
    reason_note: string | null;
    override_reason: string | null;
    settle: { kind: 'REFUND' | 'EXCHANGE'; method?: string; reference?: string | null };
    approval?: ManagerApprovalBody | null;
}

export interface PosReturnAnswer {
    return_id: string;
    return_number: string | null;
    credit_note_id: string | null;
    credit_note_number: string | null;
    credit: number;
    refund: { id: string; method: string; amount: number; status: string } | null;
    exchange_credit: number | null;
    /** The same request was already answered (a retry): nothing happened twice. */
    replayed: boolean;
}

// ─── Settings (§3.4) and bill books (existing /document-series) ──────────────

export interface PosSettings {
    cashier_discount_percent: number;
    cash_refund_limit: number;
    cash_variance_limit: number;
    configured: boolean;
}

export interface DocumentSeries {
    id: string;
    location_id: string | null;
    register_id: string | null;
    channel: string | null;
    document_type: string | null;
    kind: string | null;
    prefix: string | null;
    financial_year: string | null;
    next_value: number | null;
    book_from: number | null;
    book_to: number | null;
    status: string | null;
    next_number_preview: string | null;
}

export interface BillBookCreateBody {
    kind: 'MANUAL_BOOK';
    document_type: string;
    location_id: string;
    prefix: string;
    financial_year?: string;
    book_from: number;
    book_to: number;
}
