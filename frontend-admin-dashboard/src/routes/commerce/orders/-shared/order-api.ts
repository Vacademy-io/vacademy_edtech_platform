import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { asList, asRecord, instituteParams, num, str } from '@/routes/commerce/-shared/commerce-api';
import {
    COMMERCE_COD_REMITTANCES,
    COMMERCE_CREDIT_NOTE_PDF,
    COMMERCE_CREDIT_NOTES,
    COMMERCE_INVOICE_PDF,
    COMMERCE_INVOICE_REISSUE_B2B,
    COMMERCE_ORDER_BY_ID,
    COMMERCE_ORDER_LINE_CANCEL,
    COMMERCE_ORDER_LINKS_REVOKE,
    COMMERCE_ORDER_NOTIFICATIONS,
    COMMERCE_ORDER_RECEIPTS,
    COMMERCE_ORDER_STOCK_SHORT_CLEAR,
    COMMERCE_ORDER_TRANSITION,
    COMMERCE_ORDERS,
    COMMERCE_ORDERS_BULK,
    COMMERCE_REFUND_CANCEL,
    COMMERCE_REFUND_CHECK,
    COMMERCE_REFUND_PAYOUT,
    COMMERCE_REFUNDS,
    COMMERCE_RETURN_APPROVE,
    COMMERCE_RETURN_BY_ID,
    COMMERCE_RETURN_PREVIEW,
    COMMERCE_RETURN_RECEIVE,
    COMMERCE_RETURN_REJECT,
    COMMERCE_RETURNS,
    COMMERCE_SCAN,
    COMMERCE_SHIPMENT_BY_ID,
    COMMERCE_SHIPMENT_SHIP,
    COMMERCE_SHIPMENT_STATUS,
    COMMERCE_SHIPMENTS,
} from '@/routes/commerce/-shared/commerce-urls';
import type {
    BulkBody,
    BulkResult,
    CreditNoteRow,
    DeliveryView,
    LineCancelBody,
    OrderAddress,
    PackBody,
    ReceiptBody,
    RefundBody,
    RefundSummary,
    RefundView,
    RemittanceBody,
    RemittancePage,
    RemittanceView,
    ReturnCreateBody,
    ReturnLineRequest,
    ReturnPreview,
    ReturnReceiveBody,
    ReturnSummary,
    ReturnView,
    ScanResult,
    ShipBody,
    ShipmentStatusBody,
    StaffOrderBody,
    StaffOrderDetail,
    StaffOrderLine,
    StaffOrderPage,
    StaffOrderRow,
    StaffShipment,
    Totals,
    TrackingPatchBody,
    TransitionBody,
} from './order-types';
import { normaliseScannedCode } from './use-scan-input';

/**
 * Order desk services: one function per endpoint, no React. Every answer is
 * normalised here (money to numbers, arrays never absent) so a screen never
 * meets a `"120.00"` string or an `undefined` list.
 */

const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const int = (value: unknown, fallback = 0): number => num(value) ?? fallback;
const bool = (value: unknown): boolean => value === true;
const records = (value: unknown): Record<string, unknown>[] =>
    (Array.isArray(value) ? value : []).map(asRecord).filter((r): r is Record<string, unknown> => !!r);

export function normalizeRow(data: unknown): StaffOrderRow {
    const r = asRecord(data) ?? {};
    const row: StaffOrderRow = {
        id: str(r.id) ?? '',
        order_number: str(r.order_number) ?? '',
        channel: str(r.channel),
        status: str(r.status) ?? '',
        payment_status: str(r.payment_status),
        payment_method: str(r.payment_method),
        cancel_reason: str(r.cancel_reason),
        customer_name: str(r.customer_name),
        customer_phone: str(r.customer_phone),
        currency: str(r.currency) ?? 'INR',
        total: num(r.total) ?? 0,
        amount_paid: num(r.amount_paid) ?? 0,
        created_at: str(r.created_at),
        stock_short: bool(r.stock_short),
        refund_due: num(r.refund_due),
        shipment_status: str(r.shipment_status),
        tracking_number: str(r.tracking_number),
        status_since: str(r.status_since),
        refund_open: num(r.refund_open),
        refund_state: str(r.refund_state),
        return_state: str(r.return_state),
    };
    const cod = num(r.cod_amount);
    if (cod !== null) row.cod_amount = cod;
    const due = num(r.amount_due);
    if (due !== null) row.amount_due = due;
    return row;
}

const normalizeTotals = (data: unknown): Totals | null => {
    const r = asRecord(data);
    if (!r) return null;
    return {
        subtotal: num(r.subtotal),
        discount: num(r.discount),
        shipping: num(r.shipping),
        cod_charge: num(r.cod_charge),
        tax: num(r.tax),
        round_off: num(r.round_off),
        total: num(r.total),
        amount_paid: num(r.amount_paid),
    };
};

const normalizeLine = (r: Record<string, unknown>): StaffOrderLine => {
    const line: StaffOrderLine = {
        id: str(r.id) ?? '',
        line_no: int(r.line_no),
        line_type: str(r.line_type),
        package_session_id: str(r.package_session_id),
        package_id: str(r.package_id),
        name: str(r.name),
        variant_label: str(r.variant_label),
        sku: str(r.sku),
        unit: str(r.unit),
        qty_scale: int(r.qty_scale, 1) || 1,
        quantity: int(r.quantity),
        unit_price: num(r.unit_price),
        mrp: num(r.mrp),
        discount: num(r.discount),
        tax_rate: num(r.tax_rate),
        line_total: num(r.line_total),
        qty_cancelled: int(r.qty_cancelled),
        qty_shipped: int(r.qty_shipped),
        qty_returned: int(r.qty_returned),
        stock_short_qty: num(r.stock_short_qty),
        list_unit_price: num(r.list_unit_price),
        price_override_by: str(r.price_override_by),
    };
    if (str(r.stock_mode)) line.stock_mode = str(r.stock_mode);
    if (str(r.stock_policy)) line.stock_policy = str(r.stock_policy);
    return line;
};

const normalizeShipment = (r: Record<string, unknown>): StaffShipment => ({
    id: str(r.id) ?? '',
    status: str(r.status) ?? '',
    location_id: str(r.location_id),
    carrier_name: str(r.carrier_name),
    tracking_number: str(r.tracking_number),
    tracking_url: str(r.tracking_url),
    weight_grams: num(r.weight_grams),
    invoice_id: str(r.invoice_id),
    rto_reason: str(r.rto_reason),
    packed_at: str(r.packed_at),
    shipped_at: str(r.shipped_at),
    delivered_on: str(r.delivered_on),
    rto_at: str(r.rto_at),
    rto_received_at: str(r.rto_received_at),
    cancelled_at: str(r.cancelled_at),
    lines: records(r.lines).map((l) => {
        const line = {
            id: str(l.id) ?? '',
            order_line_id: str(l.order_line_id) ?? '',
            quantity: int(l.quantity),
            piece_codes: strings(l.piece_codes),
        } as StaffShipment['lines'][number];
        if (Array.isArray(l.piece_ids)) line.piece_ids = strings(l.piece_ids);
        return line;
    }),
});

export const normalizeReturnSummary = (r: Record<string, unknown>): ReturnSummary => ({
    id: str(r.id) ?? '',
    return_number: str(r.return_number),
    order_id: str(r.order_id),
    status: str(r.status),
    reason: str(r.reason),
    location_id: str(r.location_id),
    units: num(r.units),
    credit_total: num(r.credit_total),
    refunded: num(r.refunded),
    created_at: str(r.created_at),
});

export const normalizeRefundSummary = (r: Record<string, unknown>): RefundSummary => ({
    id: str(r.id) ?? '',
    order_id: str(r.order_id),
    return_id: str(r.return_id),
    return_number: str(r.return_number),
    method: str(r.method),
    amount: num(r.amount),
    currency: str(r.currency),
    status: str(r.status),
    reference: str(r.reference),
    paid_on: str(r.paid_on),
    failure_code: str(r.failure_code),
    created_at: str(r.created_at),
    processed_at: str(r.processed_at),
    failed_at: str(r.failed_at),
});

export const normalizeDelivery = (r: Record<string, unknown>): DeliveryView => ({
    trigger: str(r.trigger),
    channel: str(r.channel),
    status: str(r.status),
    code: str(r.code),
    locale: str(r.locale),
    recipient_masked: str(r.recipient_masked),
    created_at: str(r.created_at),
    sent_at: str(r.sent_at),
});

const address = (value: unknown): OrderAddress | null => {
    const r = asRecord(value);
    if (!r) return null;
    return {
        name: str(r.name),
        phone: str(r.phone),
        line1: str(r.line1),
        line2: str(r.line2),
        landmark: str(r.landmark),
        city: str(r.city),
        state_code: str(r.state_code),
        pincode: str(r.pincode),
    };
};

export function normalizeDetail(data: unknown): StaffOrderDetail {
    const r = asRecord(data) ?? {};
    return {
        order: normalizeRow(r.order),
        customer_id: str(r.customer_id),
        customer_email: str(r.customer_email),
        shipping_address: address(r.shipping_address),
        billing_address: address(r.billing_address),
        buyer_gstin: str(r.buyer_gstin),
        totals: normalizeTotals(r.totals),
        coupon_code: str(r.coupon_code),
        customer_note: str(r.customer_note),
        gift_note: str(r.gift_note),
        fulfilment_location_id: str(r.fulfilment_location_id),
        gateway_order_id: str(r.gateway_order_id),
        confirmed_at: str(r.confirmed_at),
        cancelled_at: str(r.cancelled_at),
        lines: records(r.lines).map(normalizeLine).sort((a, b) => a.line_no - b.line_no),
        tenders: records(r.tenders).map((t) => ({
            id: str(t.id) ?? '',
            mode: str(t.mode),
            amount: num(t.amount),
            status: str(t.status),
            reference: str(t.reference),
            received_at: str(t.received_at),
        })),
        timeline: records(r.timeline).map((e) => ({
            from_status: str(e.from_status),
            status: str(e.status),
            at: str(e.at),
            note: str(e.note),
            actor_user_id: str(e.actor_user_id),
        })),
        shipments: records(r.shipments).map(normalizeShipment),
        stock_short: bool(r.stock_short),
        cod_amount: num(r.cod_amount),
        cod_remittance_id: str(r.cod_remittance_id),
        invoice_id: str(r.invoice_id),
        credit_note_ids: strings(r.credit_note_ids),
        next_actions: strings(r.next_actions),
        refund_committed: num(r.refund_committed),
        amount_refunded: num(r.amount_refunded),
        refund_open: num(r.refund_open),
        amount_due: num(r.amount_due),
        returns: records(r.returns).map(normalizeReturnSummary),
        refunds: records(r.refunds).map(normalizeRefundSummary),
        exchange_of_order_id: str(r.exchange_of_order_id),
        notifications: records(r.notifications).map(normalizeDelivery),
        replayed: bool(r.replayed),
    };
}

export function normalizeReturnView(data: unknown): ReturnView {
    const r = asRecord(data) ?? {};
    const note = asRecord(r.credit_note);
    return {
        id: str(r.id) ?? '',
        return_number: str(r.return_number),
        order_id: str(r.order_id),
        order_number: str(r.order_number),
        status: str(r.status),
        reason: str(r.reason),
        reason_note: str(r.reason_note),
        requested_via: str(r.requested_via),
        location_id: str(r.location_id),
        lines: records(r.lines).map((l) => ({
            id: str(l.id) ?? '',
            order_line_id: str(l.order_line_id) ?? '',
            line_no: num(l.line_no),
            name: str(l.name),
            sku: str(l.sku),
            quantity: int(l.quantity),
            qty_resaleable: num(l.qty_resaleable),
            qty_damaged: num(l.qty_damaged),
            piece_codes: strings(l.piece_codes),
            credited_value: num(l.credited_value),
        })),
        policy_warnings: strings(r.policy_warnings),
        override_reason: str(r.override_reason),
        credit_note: note ? { id: str(note.id) ?? '', number: str(note.number), total: num(note.total) } : null,
        credit_total: num(r.credit_total),
        due_raised: num(r.due_raised),
        refunded: num(r.refunded),
        refunds: records(r.refunds).map(normalizeRefundSummary),
        created_at: str(r.created_at),
        approved_at: str(r.approved_at),
        rejected_at: str(r.rejected_at),
        reject_reason: str(r.reject_reason),
        received_at: str(r.received_at),
        closed_at: str(r.closed_at),
        next_actions: strings(r.next_actions),
    };
}

export function normalizeRefundView(data: unknown): RefundView {
    const r = asRecord(data) ?? {};
    return {
        ...normalizeRefundSummary(r),
        reason: str(r.reason),
        failure_reason: str(r.failure_reason),
    };
}

export function normalizeRemittance(data: unknown): RemittanceView {
    const r = asRecord(data) ?? {};
    return {
        id: str(r.id) ?? '',
        reference: str(r.reference),
        courier_name: str(r.courier_name),
        received_on: str(r.received_on),
        gross_amount: num(r.gross_amount),
        deductions: num(r.deductions),
        net_amount: num(r.net_amount),
        orders_total: num(r.orders_total),
        order_count: num(r.order_count),
        difference_reason: str(r.difference_reason),
        note: str(r.note),
        created_at: str(r.created_at),
        orders: records(r.orders).map((o) => ({
            order_id: str(o.order_id) ?? '',
            order_number: str(o.order_number),
            cod_amount: num(o.cod_amount),
        })),
    };
}

export function normalizeScan(data: unknown): ScanResult | null {
    const r = asRecord(data);
    const variant = asRecord(r?.variant);
    const packageSessionId = str(variant?.package_session_id);
    if (!r || !variant || !packageSessionId) return null;
    const piece = asRecord(r.piece);
    return {
        kind: str(r.kind)?.toUpperCase() === 'PIECE' ? 'PIECE' : 'VARIANT',
        variant: {
            package_session_id: packageSessionId,
            package_id: str(variant.package_id),
            sku: str(variant.sku),
            product_name: str(variant.product_name),
            variant_name: str(variant.variant_name),
            stock_mode: str(variant.stock_mode),
            stock_policy: str(variant.stock_policy),
            unit: str(variant.unit),
            qty_scale: int(variant.qty_scale, 1) || 1,
        },
        piece:
            piece && str(piece.id) && str(piece.code)
                ? {
                      id: str(piece.id) as string,
                      code: str(piece.code) as string,
                      status: str(piece.status),
                      location_id: str(piece.location_id),
                  }
                : null,
    };
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function fetchOrders(params: Record<string, string | number>): Promise<StaffOrderPage> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_ORDERS, {
        params: { ...instituteParams(), ...params },
    });
    const r = asRecord(res.data) ?? {};
    return {
        orders: records(r.orders).map(normalizeRow),
        page: int(r.page),
        page_size: int(r.page_size, Number(params.pageSize) || 50),
        total: int(r.total),
    };
}

export async function fetchOrder(orderId: string): Promise<StaffOrderDetail> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_ORDER_BY_ID(orderId), {
        params: instituteParams(),
    });
    return normalizeDetail(res.data);
}

const postDetail = async (url: string, body: unknown): Promise<StaffOrderDetail> => {
    const res = await authenticatedAxiosInstance.post<unknown>(url, body, { params: instituteParams() });
    return normalizeDetail(res.data);
};

export const transitionOrder = (orderId: string, body: TransitionBody) =>
    postDetail(COMMERCE_ORDER_TRANSITION(orderId), body);

export const cancelOrderLine = (orderId: string, lineId: string, body: LineCancelBody) =>
    postDetail(COMMERCE_ORDER_LINE_CANCEL(orderId, lineId), body);

export const recordReceipt = (orderId: string, body: ReceiptBody) =>
    postDetail(COMMERCE_ORDER_RECEIPTS(orderId), body);

export const clearStockShort = (orderId: string, body: { client_request_id: string; note: string }) =>
    postDetail(COMMERCE_ORDER_STOCK_SHORT_CLEAR(orderId), body);

export const createStaffOrder = (body: StaffOrderBody) => postDetail(COMMERCE_ORDERS, body);

export async function bulkOrders(body: BulkBody): Promise<BulkResult[]> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_ORDERS_BULK, body, {
        params: instituteParams(),
    });
    return records(asRecord(res.data)?.results).map((r) => ({
        order_id: str(r.order_id) ?? '',
        ok: r.ok === true,
        code: str(r.code),
        message: str(r.message),
    }));
}

export async function fetchOrderNotifications(orderId: string): Promise<DeliveryView[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_ORDER_NOTIFICATIONS(orderId), {
        params: instituteParams(),
    });
    return records(asRecord(res.data)?.items).map(normalizeDelivery);
}

export async function revokeOrderLinks(orderId: string): Promise<void> {
    await authenticatedAxiosInstance.post(COMMERCE_ORDER_LINKS_REVOKE(orderId), {}, { params: instituteParams() });
}

// ─── Shipments ───────────────────────────────────────────────────────────────

export const packOrder = (body: PackBody) => postDetail(COMMERCE_SHIPMENTS, body);

export const shipShipment = (shipmentId: string, body: ShipBody) =>
    postDetail(COMMERCE_SHIPMENT_SHIP(shipmentId), body);

export const changeShipmentStatus = (shipmentId: string, body: ShipmentStatusBody) =>
    postDetail(COMMERCE_SHIPMENT_STATUS(shipmentId), body);

export async function patchShipment(shipmentId: string, body: TrackingPatchBody): Promise<StaffOrderDetail> {
    const res = await authenticatedAxiosInstance.patch<unknown>(COMMERCE_SHIPMENT_BY_ID(shipmentId), body, {
        params: instituteParams(),
    });
    return normalizeDetail(res.data);
}

// ─── Scan ────────────────────────────────────────────────────────────────────

/** null = the code is unknown (404). Other failures throw. */
export async function scanCode(code: string): Promise<ScanResult | null> {
    try {
        // A label's QR link is read as its code, for callers with their own input.
        const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_SCAN(normaliseScannedCode(code)), {
            params: instituteParams(),
        });
        return normalizeScan(res.data);
    } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404) return null;
        throw error;
    }
}

// ─── COD remittances ─────────────────────────────────────────────────────────

export async function fetchRemittances(params: {
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
}): Promise<RemittancePage> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_COD_REMITTANCES, {
        params: {
            ...instituteParams(),
            from: params.from || undefined,
            to: params.to || undefined,
            page: params.page ?? 0,
            pageSize: params.pageSize ?? 20,
        },
    });
    const r = asRecord(res.data) ?? {};
    return {
        items: records(r.items).map(normalizeRemittance),
        page: int(r.page),
        page_size: int(r.page_size, params.pageSize ?? 20),
        total: int(r.total),
    };
}

export async function recordRemittance(body: RemittanceBody): Promise<RemittanceView> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_COD_REMITTANCES, body, {
        params: instituteParams(),
    });
    return normalizeRemittance(res.data);
}

// ─── Returns and refunds ─────────────────────────────────────────────────────

export async function previewReturn(body: {
    order_id: string;
    reason?: string;
    requested_via?: string;
    lines: ReturnLineRequest[];
}): Promise<ReturnPreview> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_RETURN_PREVIEW, body, {
        params: instituteParams(),
    });
    const r = asRecord(res.data) ?? {};
    const policy = asRecord(r.policy);
    const text = asRecord(policy?.policy_text) ?? {};
    return {
        policy: policy
            ? {
                  window_days: num(policy.window_days),
                  delivered_on: str(policy.delivered_on),
                  days_since_delivery: num(policy.days_since_delivery),
                  allowed_reasons: strings(policy.allowed_reasons),
                  photo_required: policy.photo_required === true,
                  return_shipping_paid_by: str(policy.return_shipping_paid_by),
                  policy_text: Object.fromEntries(
                      Object.entries(text).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
                  ),
              }
            : null,
        warnings: strings(r.warnings),
        lines: records(r.lines).map((l) => ({
            order_line_id: str(l.order_line_id) ?? '',
            returnable_quantity: int(l.returnable_quantity),
        })),
        credit_estimate: num(r.credit_estimate),
        credit_to_due: num(r.credit_to_due),
        refund_amount: num(r.refund_amount),
    };
}

export async function createReturn(body: ReturnCreateBody): Promise<ReturnView> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_RETURNS, body, { params: instituteParams() });
    return normalizeReturnView(res.data);
}

export async function fetchReturn(returnId: string): Promise<ReturnView> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_RETURN_BY_ID(returnId), {
        params: instituteParams(),
    });
    return normalizeReturnView(res.data);
}

const postReturn = async (url: string, body: unknown): Promise<ReturnView> => {
    const res = await authenticatedAxiosInstance.post<unknown>(url, body, { params: instituteParams() });
    return normalizeReturnView(res.data);
};

export const approveReturn = (returnId: string, body: { client_request_id: string; from_status: string; note?: string }) =>
    postReturn(COMMERCE_RETURN_APPROVE(returnId), body);

export const rejectReturn = (returnId: string, body: { client_request_id: string; from_status: string; reason: string }) =>
    postReturn(COMMERCE_RETURN_REJECT(returnId), body);

export const receiveReturn = (returnId: string, body: ReturnReceiveBody) =>
    postReturn(COMMERCE_RETURN_RECEIVE(returnId), body);

export async function createRefund(body: RefundBody): Promise<RefundView> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_REFUNDS, body, { params: instituteParams() });
    return normalizeRefundView(res.data);
}

const postRefund = async (url: string, body: unknown): Promise<RefundView> => {
    const res = await authenticatedAxiosInstance.post<unknown>(url, body, { params: instituteParams() });
    return normalizeRefundView(res.data);
};

export const recordRefundPayout = (
    refundId: string,
    body: { client_request_id: string; reference: string; paid_on?: string }
) => postRefund(COMMERCE_REFUND_PAYOUT(refundId), body);

export const cancelRefund = (refundId: string, body: { client_request_id: string; reason: string }) =>
    postRefund(COMMERCE_REFUND_CANCEL(refundId), body);

export const checkRefund = (refundId: string, body: { client_request_id: string }) =>
    postRefund(COMMERCE_REFUND_CHECK(refundId), body);

// ─── Documents ───────────────────────────────────────────────────────────────

const urlOf = (data: unknown): string | null => str(asRecord(data)?.url);

export async function fetchInvoicePdfUrl(invoiceId: string): Promise<string | null> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_INVOICE_PDF(invoiceId), {
        params: instituteParams(),
    });
    return urlOf(res.data);
}

export async function fetchCreditNotePdfUrl(creditNoteId: string): Promise<string | null> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_CREDIT_NOTE_PDF(creditNoteId), {
        params: instituteParams(),
    });
    return urlOf(res.data);
}

export async function fetchCreditNotes(invoiceId: string): Promise<CreditNoteRow[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_CREDIT_NOTES, {
        params: { ...instituteParams(), invoiceId, page: 0, size: 50 },
    });
    return asList<unknown>(res.data)
        .map(asRecord)
        .filter((r): r is Record<string, unknown> => !!r && !!str(r.id))
        .map((r) => ({
            id: str(r.id) as string,
            credit_note_number: str(r.credit_note_number),
            return_id: str(r.return_id),
            document_date: str(r.document_date),
            total: num(r.total),
            pdf_ready: r.pdf_ready === true,
        }));
}

export async function reissueInvoiceB2b(
    invoiceId: string,
    body: { buyer_gstin: string; buyer_name?: string; billing_address?: string }
): Promise<void> {
    await authenticatedAxiosInstance.post(COMMERCE_INVOICE_REISSUE_B2B(invoiceId), body, {
        params: instituteParams(),
    });
}

/** Refunds of an order (M, Ac). The detail already carries them; this is for lists. */
export async function fetchRefunds(params: Record<string, string | number>): Promise<RefundSummary[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_REFUNDS, {
        params: { ...instituteParams(), ...params },
    });
    return records(asRecord(res.data)?.refunds).map(normalizeRefundSummary);
}
