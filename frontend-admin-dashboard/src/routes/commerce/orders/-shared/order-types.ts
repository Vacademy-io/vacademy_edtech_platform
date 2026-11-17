/**
 * Order desk wire types (snake_case, as the staff endpoints answer them), after
 * `order-api` has normalised them: money is a number (the server sends a
 * BigDecimal as a number or a string), arrays are never absent, and the B1
 * fields (`stock_mode`, `stock_policy`, `piece_ids`, `cod_amount`) stay optional
 * so the screens work on a backend that does not send them yet.
 */

export type OrderStatus =
    | 'PENDING_PAYMENT'
    | 'COD_PENDING_CONFIRMATION'
    | 'CONFIRMED'
    | 'PACKED'
    | 'SHIPPED'
    | 'DELIVERED'
    | 'RTO'
    | 'CANCELLED';

export type ShipmentStatus = 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'RTO' | 'RTO_RECEIVED' | 'CANCELLED';

/** Queue ids the server knows (`CommerceOrderQueryService`), plus the UI's own "ALL". */
export const ORDER_QUEUES = [
    'TO_CONFIRM',
    'TO_PACK',
    'TO_SHIP',
    'IN_TRANSIT',
    'COD_TO_COLLECT',
    'RTO_TO_RECEIVE',
    'STOCK_SHORT',
    'DUES',
    'RETURNS',
    'REFUND_DUE',
    'ALL',
] as const;
export type OrderQueue = (typeof ORDER_QUEUES)[number];

/** Codes the server can put in `next_actions` (CommerceOrderTransitions). */
export const ORDER_ACTION_CODES = [
    'CONFIRM',
    'PACK',
    'SHIP',
    'DELIVER',
    'RTO',
    'RTO_RECEIVE',
    'EDIT_TRACKING',
    'UNPACK',
    'UNDO_SHIP',
    'UNDO_DELIVERY',
    'CANCEL',
    'CANCEL_LINE',
    'RECORD_RECEIPT',
    'CLEAR_STOCK_SHORT',
    'CREATE_RETURN',
    'REFUND',
] as const;
export type OrderActionCode = (typeof ORDER_ACTION_CODES)[number];

export const ORDER_CHANNELS = ['ONLINE', 'ADMIN', 'POS'] as const;
export const PAYMENT_METHODS = ['PREPAID', 'COD', 'OFFLINE'] as const;
export const RTO_REASONS = ['REFUSED', 'UNREACHABLE', 'ADDRESS_ISSUE', 'DAMAGED', 'OTHER'] as const;
export const CONDITIONS = ['RESALEABLE', 'DAMAGED'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const TENDER_MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'] as const;
export type TenderMode = (typeof TENDER_MODES)[number];
export const REFUND_METHODS = ['GATEWAY', 'UPI', 'BANK_TRANSFER', 'CASH'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];
export const RETURN_REASONS = [
    'DEFECTIVE',
    'WRONG_ITEM',
    'DAMAGED_IN_TRANSIT',
    'SIZE',
    'CHANGED_MIND',
    'OTHER',
] as const;
export const RETURN_VIA = ['PHONE', 'WHATSAPP', 'EMAIL', 'COUNTER', 'OTHER'] as const;
export const RETURN_ACTION_CODES = ['APPROVE', 'REJECT', 'RECEIVE', 'REFUND'] as const;
export type ReturnActionCode = (typeof RETURN_ACTION_CODES)[number];

export interface StaffOrderRow {
    id: string;
    order_number: string;
    channel: string | null;
    status: OrderStatus | string;
    payment_status: string | null;
    payment_method: string | null;
    cancel_reason: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    currency: string;
    total: number;
    amount_paid: number;
    created_at: string | null;
    stock_short: boolean;
    refund_due: number | null;
    shipment_status: string | null;
    tracking_number: string | null;
    status_since: string | null;
    refund_open: number | null;
    refund_state: string | null;
    return_state: string | null;
    /** B1: what the courier collects; absent on a backend without B1. */
    cod_amount?: number | null;
}

export interface StaffOrderPage {
    orders: StaffOrderRow[];
    page: number;
    page_size: number;
    total: number;
}

export interface Totals {
    subtotal: number | null;
    discount: number | null;
    shipping: number | null;
    cod_charge: number | null;
    tax: number | null;
    round_off: number | null;
    total: number | null;
    amount_paid: number | null;
}

export interface StaffOrderLine {
    id: string;
    line_no: number;
    line_type: string | null;
    package_session_id: string | null;
    package_id: string | null;
    name: string | null;
    variant_label: string | null;
    sku: string | null;
    unit: string | null;
    qty_scale: number;
    quantity: number;
    unit_price: number | null;
    mrp: number | null;
    discount: number | null;
    tax_rate: number | null;
    line_total: number | null;
    qty_cancelled: number;
    qty_shipped: number;
    qty_returned: number;
    stock_short_qty: number | null;
    list_unit_price: number | null;
    price_override_by: string | null;
    /** B1: `PIECE` | `QUANTITY`; absent before B1 and on shipping/COD lines. */
    stock_mode?: string | null;
    /** B1: `TRACKED` | `UNTRACKED`. */
    stock_policy?: string | null;
}

export interface StaffShipmentLine {
    id: string;
    order_line_id: string;
    quantity: number;
    piece_codes: string[];
    /** B1: ids in the same order as `piece_codes`. */
    piece_ids?: string[];
}

export interface StaffShipment {
    id: string;
    status: ShipmentStatus | string;
    location_id: string | null;
    carrier_name: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    weight_grams: number | null;
    invoice_id: string | null;
    rto_reason: string | null;
    packed_at: string | null;
    shipped_at: string | null;
    delivered_on: string | null;
    rto_at: string | null;
    rto_received_at: string | null;
    cancelled_at: string | null;
    lines: StaffShipmentLine[];
}

export interface StaffTender {
    id: string;
    mode: string | null;
    amount: number | null;
    status: string | null;
    reference: string | null;
    received_at: string | null;
}

export interface StaffTimelineEntry {
    from_status: string | null;
    status: string | null;
    at: string | null;
    note: string | null;
    actor_user_id: string | null;
}

export interface ReturnSummary {
    id: string;
    return_number: string | null;
    order_id: string | null;
    status: string | null;
    reason: string | null;
    location_id: string | null;
    units: number | null;
    credit_total: number | null;
    refunded: number | null;
    created_at: string | null;
}

export interface RefundSummary {
    id: string;
    order_id: string | null;
    return_id: string | null;
    return_number: string | null;
    method: string | null;
    amount: number | null;
    currency: string | null;
    status: string | null;
    reference: string | null;
    paid_on: string | null;
    failure_code: string | null;
    created_at: string | null;
    processed_at: string | null;
    failed_at: string | null;
}

export interface DeliveryView {
    trigger: string | null;
    channel: string | null;
    status: string | null;
    code: string | null;
    locale: string | null;
    recipient_masked: string | null;
    created_at: string | null;
    sent_at: string | null;
}

/** An address as the order stores it; only these keys are drawn. */
export interface OrderAddress {
    name?: string | null;
    phone?: string | null;
    line1?: string | null;
    line2?: string | null;
    landmark?: string | null;
    city?: string | null;
    state_code?: string | null;
    pincode?: string | null;
}

export interface StaffOrderDetail {
    order: StaffOrderRow;
    customer_id: string | null;
    customer_email: string | null;
    shipping_address: OrderAddress | null;
    billing_address: OrderAddress | null;
    buyer_gstin: string | null;
    totals: Totals | null;
    coupon_code: string | null;
    customer_note: string | null;
    gift_note: string | null;
    fulfilment_location_id: string | null;
    gateway_order_id: string | null;
    confirmed_at: string | null;
    cancelled_at: string | null;
    lines: StaffOrderLine[];
    tenders: StaffTender[];
    timeline: StaffTimelineEntry[];
    shipments: StaffShipment[];
    stock_short: boolean;
    cod_amount: number | null;
    cod_remittance_id: string | null;
    invoice_id: string | null;
    credit_note_ids: string[];
    next_actions: string[];
    refund_committed: number | null;
    amount_refunded: number | null;
    refund_open: number | null;
    returns: ReturnSummary[];
    refunds: RefundSummary[];
    exchange_of_order_id: string | null;
    notifications: DeliveryView[];
    replayed: boolean;
}

export interface ReturnLineView {
    id: string;
    order_line_id: string;
    line_no: number | null;
    name: string | null;
    sku: string | null;
    quantity: number;
    qty_resaleable: number | null;
    qty_damaged: number | null;
    piece_codes: string[];
    credited_value: number | null;
}

export interface ReturnView {
    id: string;
    return_number: string | null;
    order_id: string | null;
    order_number: string | null;
    status: string | null;
    reason: string | null;
    reason_note: string | null;
    requested_via: string | null;
    location_id: string | null;
    lines: ReturnLineView[];
    policy_warnings: string[];
    override_reason: string | null;
    credit_note: { id: string; number: string | null; total: number | null } | null;
    credit_total: number | null;
    due_raised: number | null;
    refunded: number | null;
    refunds: RefundSummary[];
    created_at: string | null;
    approved_at: string | null;
    rejected_at: string | null;
    reject_reason: string | null;
    received_at: string | null;
    closed_at: string | null;
    next_actions: string[];
}

export interface ReturnPolicy {
    window_days: number | null;
    delivered_on: string | null;
    days_since_delivery: number | null;
    allowed_reasons: string[];
    photo_required: boolean;
    return_shipping_paid_by: string | null;
    policy_text: Record<string, string>;
}

export interface ReturnPreview {
    policy: ReturnPolicy | null;
    warnings: string[];
    lines: { order_line_id: string; returnable_quantity: number }[];
    credit_estimate: number | null;
}

export interface RefundView extends RefundSummary {
    reason: string | null;
    failure_reason: string | null;
}

export interface RemittedOrder {
    order_id: string;
    order_number: string | null;
    cod_amount: number | null;
}

export interface RemittanceView {
    id: string;
    reference: string | null;
    courier_name: string | null;
    received_on: string | null;
    gross_amount: number | null;
    deductions: number | null;
    net_amount: number | null;
    orders_total: number | null;
    order_count: number | null;
    difference_reason: string | null;
    note: string | null;
    created_at: string | null;
    orders: RemittedOrder[];
}

export interface RemittancePage {
    items: RemittanceView[];
    page: number;
    page_size: number;
    total: number;
}

export interface BulkResult {
    order_id: string;
    ok: boolean;
    code: string | null;
    message: string | null;
}

export interface ScanVariant {
    package_session_id: string;
    package_id: string | null;
    sku: string | null;
    product_name: string | null;
    variant_name: string | null;
    stock_mode: string | null;
    stock_policy: string | null;
    unit: string | null;
    qty_scale: number;
}

export interface ScanResult {
    kind: 'PIECE' | 'VARIANT';
    variant: ScanVariant;
    piece: { id: string; code: string; status: string | null; location_id: string | null } | null;
}

export interface CreditNoteRow {
    id: string;
    credit_note_number: string | null;
    return_id: string | null;
    document_date: string | null;
    total: number | null;
    pdf_ready: boolean;
}

// ─── Request bodies ──────────────────────────────────────────────────────────

export interface TransitionBody {
    client_request_id: string;
    from_status: string;
    to_status: string;
    reason?: string;
    note?: string;
}

export interface PackBody {
    client_request_id: string;
    order_id: string;
    from_status: 'CONFIRMED';
    lines: { order_line_id: string; quantity: number; piece_codes?: string[] }[];
    weight_grams?: number;
}

export interface ShipBody {
    client_request_id: string;
    carrier_name: string;
    tracking_number: string;
    tracking_url?: string;
    weight_grams?: number;
    notify_customer: boolean;
}

export interface StatusLine {
    order_line_id: string;
    condition: Condition;
    quantity: number;
    piece_ids?: string[];
}

export interface ShipmentStatusBody {
    client_request_id: string;
    to: 'DELIVERED' | 'RTO' | 'RTO_RECEIVED';
    delivered_on?: string;
    rto_reason?: string;
    lines?: StatusLine[];
    note?: string;
}

export interface TrackingPatchBody {
    client_request_id: string;
    carrier_name?: string;
    tracking_number?: string;
    tracking_url?: string;
}

export interface LineCancelBody {
    client_request_id: string;
    quantity: number;
    reason: string;
    note?: string;
    piece_ids?: string[];
}

export interface ReceiptBody {
    client_request_id: string;
    mode: TenderMode;
    amount: number;
    reference?: string;
    received_on?: string;
}

export interface BulkItem {
    order_id: string;
    from_status: string;
    carrier_name?: string;
    tracking_number?: string;
    tracking_url?: string;
    delivered_on?: string;
}

export type BulkAction = 'CONFIRM' | 'PACK' | 'SHIP' | 'DELIVER';

export interface BulkBody {
    client_request_id: string;
    action: BulkAction;
    items: BulkItem[];
}

export interface RemittanceBody {
    client_request_id: string;
    reference: string;
    courier_name?: string;
    received_on: string;
    gross_amount: number;
    deductions: number;
    net_amount: number;
    difference_reason?: string;
    note?: string;
    order_ids: string[];
}

export interface ReturnLineRequest {
    order_line_id: string;
    quantity: number;
}

export interface ReturnCreateBody {
    client_request_id: string;
    order_id: string;
    location_id?: string;
    reason: string;
    reason_note?: string;
    requested_via: string;
    lines: ReturnLineRequest[];
    override_reason?: string;
    approve_now: boolean;
    note?: string;
}

export interface ReturnReceiveBody {
    client_request_id: string;
    from_status: 'APPROVED';
    location_id?: string;
    lines: StatusLine[];
    note?: string;
}

export interface RefundBody {
    client_request_id: string;
    order_id: string;
    return_id?: string;
    amount: number;
    method: RefundMethod;
    reference?: string;
    paid_on?: string;
    reason?: string;
}

export interface StaffOrderBody {
    client_request_id: string;
    customer: { phone: string; name: string; email?: string };
    shipping_address?: OrderAddress;
    billing_address?: OrderAddress;
    buyer_gstin?: string;
    lines: {
        variant_id?: string;
        sku?: string;
        quantity: number;
        unit_price_override?: number;
        piece_codes?: string[];
    }[];
    coupon_code?: string;
    charge_shipping?: boolean;
    tenders?: { mode: TenderMode; amount: number; reference?: string }[];
    rest_on_credit?: boolean;
    hand_over_now?: boolean;
    customer_note?: string;
    exchange?: { return_id: string; remainder_refund?: { method: RefundMethod; reference?: string } };
}
