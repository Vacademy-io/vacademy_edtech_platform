import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { asPage, asRecord, instituteParams, num, str } from '@/routes/commerce/-shared/commerce-api';
import {
    COMMERCE_DOCUMENT_SERIES,
    COMMERCE_POS_BILL_BOOK,
    COMMERCE_POS_CUSTOMER_LOOKUP,
    COMMERCE_POS_QUOTE,
    COMMERCE_POS_REGISTER_APPROVERS,
    COMMERCE_POS_REGISTER_BY_ID,
    COMMERCE_POS_REGISTER_CATALOGUE,
    COMMERCE_POS_REGISTER_SCAN,
    COMMERCE_POS_REGISTER_SESSION,
    COMMERCE_POS_REGISTERS,
    COMMERCE_POS_RETURN_PREVIEW,
    COMMERCE_POS_RETURNS,
    COMMERCE_POS_SALE_BY_ID,
    COMMERCE_POS_SALE_RECEIPT,
    COMMERCE_POS_SALE_VOID,
    COMMERCE_POS_SALES,
    COMMERCE_POS_SALES_LOOKUP,
    COMMERCE_POS_SESSION_BY_ID,
    COMMERCE_POS_SESSION_CASH,
    COMMERCE_POS_SESSION_CLOSE,
    COMMERCE_POS_SESSION_SALES,
    COMMERCE_POS_SESSIONS,
    COMMERCE_POS_SETTINGS,
    COMMERCE_POS_TENDER_CHANGE,
} from '@/routes/commerce/-shared/commerce-urls';
import type {
    ApproverOption,
    BillBookCreateBody,
    BillBookRequest,
    CashMovementBody,
    CatalogueItem,
    CloseSessionBody,
    CountTotal,
    CustomerLookup,
    DocumentSeries,
    LocalText,
    OpenSessionBody,
    Paged,
    PosCatalogue,
    PosReturnAnswer,
    PosReturnBody,
    PosReturnLineRequest,
    PosReturnPreview,
    PosScanAnswer,
    PosSettings,
    Quote,
    QuoteRequest,
    QuoteTotals,
    Receipt,
    RegisterCreateBody,
    RegisterUpdateBody,
    RegisterView,
    SaleAnswer,
    SaleDetail,
    SaleRequest,
    SaleRow,
    SessionRow,
    SessionView,
    TaxRow,
    TenderChangeBody,
    VoidBody,
    ZReport,
} from './pos-types';

/**
 * Billing counter services: one function per endpoint, no React. Every answer
 * is normalised here (money to numbers, lists never absent, unknown fields
 * dropped), so a screen never meets `"120.00"` or `undefined` where it expects
 * a list. Every call carries `instituteId`.
 */

type Rec = Record<string, unknown>;

const rec = (value: unknown): Rec => asRecord(value) ?? {};
const records = (value: unknown): Rec[] =>
    (Array.isArray(value) ? value : []).map(asRecord).filter((r): r is Rec => !!r);
const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const money = (value: unknown): number => num(value) ?? 0;
const bool = (value: unknown): boolean => value === true;
const text = (value: unknown): string => str(value) ?? '';

const localText = (value: unknown): LocalText => {
    const r = rec(value);
    return { hi: str(r.hi), en: str(r.en) };
};

// ─── Normalisers ─────────────────────────────────────────────────────────────

export function normalizeRegister(data: unknown): RegisterView | null {
    const r = asRecord(data);
    const id = str(r?.id);
    if (!r || !id) return null;
    const open = asRecord(r.open_session);
    return {
        id,
        code: text(r.code),
        name: text(r.name),
        location_id: text(r.location_id),
        location_name: text(r.location_name),
        status: text(r.status) || 'ACTIVE',
        open_session:
            open && str(open.id)
                ? {
                      id: text(open.id),
                      cashier_user_id: str(open.cashier_user_id),
                      cashier_name: str(open.cashier_name),
                      opened_at: str(open.opened_at),
                      mine: bool(open.mine),
                  }
                : null,
        setup_warnings: strings(r.setup_warnings),
    };
}

export function normalizeCatalogueItem(data: unknown): CatalogueItem | null {
    const r = asRecord(data);
    const id = str(r?.variant_id);
    if (!r || !id) return null;
    const scale = num(r.qty_scale);
    const step = num(r.qty_step);
    return {
        variant_id: id,
        product_id: str(r.product_id),
        sku: str(r.sku),
        label_code: str(r.label_code),
        barcode: str(r.barcode),
        names: localText(r.names),
        variant_label: localText(r.variant_label),
        unit: str(r.unit),
        qty_scale: scale && scale > 0 ? scale : 1,
        qty_step: step && step > 0 ? step : 1,
        stock_mode: text(r.stock_mode) || 'QUANTITY',
        tracked: bool(r.tracked),
        unit_price: money(r.unit_price),
        mrp: num(r.mrp),
        currency: str(r.currency) ?? 'INR',
        on_hand: num(r.on_hand),
    };
}

export function normalizeCatalogue(data: unknown): PosCatalogue {
    const r = rec(data);
    return {
        register_id: text(r.register_id),
        location_id: text(r.location_id),
        generated_at: str(r.generated_at),
        truncated: bool(r.truncated),
        items: records(r.items)
            .map(normalizeCatalogueItem)
            .filter((item): item is CatalogueItem => item !== null),
    };
}

const normalizeTaxRows = (value: unknown): TaxRow[] =>
    records(value).map((r) => ({
        rate: money(r.rate),
        taxable: money(r.taxable),
        cgst: money(r.cgst),
        sgst: money(r.sgst),
        igst: money(r.igst),
        cess: money(r.cess),
    }));

const countTotal = (value: unknown): CountTotal => {
    const r = rec(value);
    return { count: money(r.count), total: money(r.total) };
};

const numberMap = (value: unknown): Record<string, number> | null => {
    const r = asRecord(value);
    if (!r) return null;
    const out: Record<string, number> = {};
    Object.entries(r).forEach(([key, v]) => {
        const n = num(v);
        if (n !== null) out[key] = n;
    });
    return out;
};

export function normalizeZReport(data: unknown): ZReport | null {
    const r = asRecord(data);
    if (!r) return null;
    const register = rec(r.register);
    const location = rec(r.location);
    const returns = rec(r.returns);
    return {
        session_id: text(r.session_id),
        register: { code: text(register.code), name: text(register.name) },
        location: { name: text(location.name) },
        cashier_user_id: str(r.cashier_user_id),
        opened_at: str(r.opened_at),
        closed_at: str(r.closed_at),
        opening_cash: money(r.opening_cash),
        bills: countTotal(r.bills),
        voided: countTotal(r.voided),
        discounts: money(r.discounts),
        by_mode: records(r.by_mode).map((m) => ({
            mode: text(m.mode),
            count: money(m.count),
            amount: money(m.amount),
        })),
        tax_by_rate: normalizeTaxRows(r.tax_by_rate),
        refunds: records(r.refunds).map((m) => ({
            method: text(m.method),
            count: money(m.count),
            amount: money(m.amount),
        })),
        returns: { count: money(returns.count), credit: money(returns.credit) },
        cash_in: money(r.cash_in),
        cash_out: money(r.cash_out),
        expected_cash: num(r.expected_cash),
        counted_cash: num(r.counted_cash),
        variance: num(r.variance),
        denominations: numberMap(r.denominations),
        bill_book: countTotal(r.bill_book),
        first_invoice_number: str(r.first_invoice_number),
        last_invoice_number: str(r.last_invoice_number),
    };
}

export function normalizeSession(data: unknown): SessionView {
    const r = rec(data);
    const register = rec(r.register);
    const location = rec(r.location);
    return {
        id: text(r.id),
        status: text(r.status) || 'OPEN',
        register: { id: text(register.id), code: text(register.code), name: text(register.name) },
        location: { id: text(location.id), name: text(location.name) },
        cashier_user_id: str(r.cashier_user_id),
        cashier_name: str(r.cashier_name),
        mine: bool(r.mine),
        opened_at: str(r.opened_at),
        opening_cash: money(r.opening_cash),
        opening_note: str(r.opening_note),
        previous_counted_cash: num(r.previous_counted_cash),
        closed_at: str(r.closed_at),
        closed_by: str(r.closed_by),
        expected_cash: num(r.expected_cash),
        counted_cash: num(r.counted_cash),
        variance: num(r.variance),
        close_note: str(r.close_note),
        denominations: numberMap(r.denominations),
        cash_movements: records(r.cash_movements).map((m) => ({
            id: text(m.id),
            type: text(m.type),
            amount: money(m.amount),
            reason: text(m.reason),
            actor_user_id: str(m.actor_user_id),
            created_at: str(m.created_at),
        })),
        summary: normalizeZReport(r.summary),
        z_report: normalizeZReport(r.z_report),
        next_actions: strings(r.next_actions),
    };
}

const normalizeSessionRow = (r: Rec): SessionRow => ({
    id: text(r.id),
    status: text(r.status),
    register_code: text(r.register_code),
    location_name: text(r.location_name),
    cashier_user_id: str(r.cashier_user_id),
    cashier_name: str(r.cashier_name),
    opened_at: str(r.opened_at),
    closed_at: str(r.closed_at),
    bills_count: money(r.bills_count),
    bills_total: money(r.bills_total),
    variance: num(r.variance),
});

export const normalizeSaleRow = (r: Rec): SaleRow => ({
    order_id: text(r.order_id),
    order_number: text(r.order_number),
    channel: text(r.channel),
    status: text(r.status),
    invoice_number: str(r.invoice_number),
    document_date: str(r.document_date),
    location_name: str(r.location_name),
    total: money(r.total),
    customer_name: str(r.customer_name),
    phone_last4: str(r.phone_last4),
    created_at: str(r.created_at),
    modes: strings(r.modes),
});

const normalizeTotals = (value: unknown): QuoteTotals => {
    const r = rec(value);
    return {
        subtotal: money(r.subtotal),
        discount: money(r.discount),
        tax: money(r.tax),
        round_off: money(r.round_off),
        total: money(r.total),
    };
};

export function normalizeQuote(data: unknown): Quote {
    const r = rec(data);
    return {
        lines: records(r.lines).map((l) => ({
            line_ref: text(l.line_ref),
            variant_id: text(l.variant_id),
            quantity: money(l.quantity),
            unit_price: money(l.unit_price),
            gross: money(l.gross),
            discount: money(l.discount),
            net: money(l.net),
            taxable_value: money(l.taxable_value),
            tax_rate: num(l.tax_rate),
            tax_amount: money(l.tax_amount),
        })),
        unavailable: records(r.unavailable).map((u) => ({
            line_ref: text(u.line_ref),
            reason: text(u.reason),
        })),
        changes: records(r.changes).map((c) => ({
            line_ref: text(c.line_ref),
            unit_price: num(c.unit_price),
        })),
        totals: normalizeTotals(r.totals),
        tax_rows: normalizeTaxRows(r.tax_rows),
        discount_percent: num(r.discount_percent),
        cashier_discount_percent: num(r.cashier_discount_percent),
        needs_approval: strings(r.needs_approval),
        exchange_credit: num(r.exchange_credit),
    };
}

export function normalizeSaleDetail(data: unknown): SaleDetail {
    const r = rec(data);
    const doc = asRecord(r.document);
    const customer = asRecord(r.customer);
    const totals = rec(r.totals);
    return {
        order_id: text(r.order_id),
        order_number: text(r.order_number),
        channel: text(r.channel),
        status: text(r.status),
        session_id: str(r.session_id),
        register_id: str(r.register_id),
        location_id: str(r.location_id),
        document: doc
            ? {
                  id: str(doc.id),
                  number: str(doc.number),
                  type: str(doc.type),
                  date: str(doc.date),
                  cancelled: bool(doc.cancelled),
              }
            : null,
        customer: customer
            ? {
                  name: str(customer.name),
                  phone_last4: str(customer.phone_last4),
                  buyer_gstin: str(customer.buyer_gstin),
              }
            : null,
        lines: records(r.lines).map((l) => ({
            order_line_id: text(l.order_line_id),
            line_no: money(l.line_no),
            variant_id: text(l.variant_id),
            sku: str(l.sku),
            name: text(l.name),
            variant_label: str(l.variant_label),
            unit: str(l.unit),
            qty_scale: num(l.qty_scale) || 1,
            quantity: money(l.quantity),
            unit_price: money(l.unit_price),
            mrp: num(l.mrp),
            discount: money(l.discount),
            taxable_value: money(l.taxable_value),
            tax_rate: num(l.tax_rate),
            tax_amount: money(l.tax_amount),
            line_total: money(l.line_total),
            piece_ids: strings(l.piece_ids),
            piece_codes: strings(l.piece_codes),
            qty_returned: money(l.qty_returned),
            returnable: money(l.returnable),
        })),
        totals: {
            ...normalizeTotals(totals),
            amount_paid: money(totals.amount_paid),
            amount_refunded: money(totals.amount_refunded),
        },
        tenders: records(r.tenders).map((tender) => ({
            id: text(tender.id),
            mode: text(tender.mode),
            amount: money(tender.amount),
            reference: str(tender.reference),
            status: text(tender.status),
            cash_tendered: num(tender.cash_tendered),
        })),
        change_due: num(r.change_due),
        returns: records(r.returns).map((ret) => ({
            id: text(ret.id),
            number: str(ret.number),
            status: text(ret.status),
            credit: money(ret.credit),
        })),
        next_actions: strings(r.next_actions),
    };
}

export function normalizeReceipt(data: unknown): Receipt {
    const r = rec(data);
    const shop = rec(r.shop);
    const location = rec(r.location);
    const register = rec(r.register);
    const doc = rec(r.document);
    const customer = rec(r.customer);
    return {
        shop: {
            trade_name: str(shop.trade_name),
            legal_name: str(shop.legal_name),
            gstin: str(shop.gstin),
            address_lines: strings(shop.address_lines),
            phone: str(shop.phone),
        },
        location: { name: str(location.name), state_code: str(location.state_code) },
        register: { code: str(register.code), name: str(register.name) },
        document: {
            type: str(doc.type),
            number: str(doc.number),
            date: str(doc.date),
            issued_at: str(doc.issued_at),
            cancelled: bool(doc.cancelled),
            cancel_reason: str(doc.cancel_reason),
            paper: bool(doc.paper),
        },
        order_number: str(r.order_number),
        customer: {
            name: str(customer.name),
            phone_last4: str(customer.phone_last4),
            buyer_gstin: str(customer.buyer_gstin),
            buyer_legal_name: str(customer.buyer_legal_name),
        },
        lines: records(r.lines).map((l) => ({
            name: text(l.name),
            variant_label: str(l.variant_label),
            quantity: money(l.quantity),
            qty_scale: num(l.qty_scale) || 1,
            unit: str(l.unit),
            unit_price: money(l.unit_price),
            discount: money(l.discount),
            net: money(l.net),
            hsn_code: str(l.hsn_code),
            tax_rate: num(l.tax_rate),
        })),
        tax_rows: normalizeTaxRows(r.tax_rows),
        totals: normalizeTotals(r.totals),
        amount_in_words: str(r.amount_in_words),
        tenders: records(r.tenders).map((tender) => ({
            mode: text(tender.mode),
            amount: money(tender.amount),
            reference: str(tender.reference),
            status: text(tender.status),
        })),
        cash_tendered: num(r.cash_tendered),
        change: num(r.change),
        qr_text: str(r.qr_text),
    };
}

const normalizeSaleAnswer = (data: unknown): SaleAnswer => {
    const r = rec(data);
    return {
        sale: normalizeSaleDetail(r.sale),
        receipt: normalizeReceipt(r.receipt),
        replayed: bool(r.replayed),
    };
};

export function normalizeSettings(data: unknown): PosSettings {
    const r = rec(data);
    return {
        cashier_discount_percent: num(r.cashier_discount_percent) ?? 5,
        cash_refund_limit: money(r.cash_refund_limit),
        cash_variance_limit: money(r.cash_variance_limit),
        configured: bool(r.configured),
    };
}

export function normalizeSeries(data: unknown): DocumentSeries | null {
    const r = asRecord(data);
    const id = str(r?.id);
    if (!r || !id) return null;
    return {
        id,
        location_id: str(r.location_id),
        register_id: str(r.register_id),
        channel: str(r.channel),
        document_type: str(r.document_type),
        kind: str(r.kind),
        prefix: str(r.prefix),
        financial_year: str(r.financial_year),
        next_value: num(r.next_value),
        book_from: num(r.book_from),
        book_to: num(r.book_to),
        status: str(r.status),
        next_number_preview: str(r.next_number_preview),
    };
}

const paged = <T>(data: unknown, key: string, map: (r: Rec) => T, fallbackSize: number): Paged<T> => {
    const r = rec(data);
    return {
        rows: records(r[key]).map(map),
        page: num(r.page) ?? 0,
        page_size: num(r.page_size) ?? fallbackSize,
        total: num(r.total) ?? 0,
    };
};

const params = (extra: Record<string, string | number | undefined> = {}) => ({
    ...instituteParams(),
    ...extra,
});

const statusOf = (error: unknown): number | undefined =>
    (error as { response?: { status?: number } })?.response?.status;

// ─── Registers ───────────────────────────────────────────────────────────────

export async function fetchRegisters(locationId?: string): Promise<RegisterView[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_REGISTERS, {
        params: params({ locationId }),
    });
    return records(rec(res.data).registers)
        .map(normalizeRegister)
        .filter((r): r is RegisterView => r !== null);
}

export async function createRegister(body: RegisterCreateBody): Promise<RegisterView | null> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_REGISTERS, body, {
        params: params(),
    });
    return normalizeRegister(res.data);
}

export async function updateRegister(id: string, body: RegisterUpdateBody): Promise<RegisterView | null> {
    const res = await authenticatedAxiosInstance.put<unknown>(COMMERCE_POS_REGISTER_BY_ID(id), body, {
        params: params(),
    });
    return normalizeRegister(res.data);
}

export async function fetchRegisterSession(registerId: string): Promise<SessionView | null> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_REGISTER_SESSION(registerId), {
        params: params(),
    });
    const session = asRecord(rec(res.data).session);
    return session ? normalizeSession(session) : null;
}

/** The whole till catalogue, or with `q` (2..64 chars) a server search of at most 50 items. */
export async function fetchCatalogue(registerId: string, q?: string): Promise<PosCatalogue> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_REGISTER_CATALOGUE(registerId), {
        params: params({ q: q || undefined }),
    });
    return normalizeCatalogue(res.data);
}

/** null = no item has this code (404 CODE_NOT_FOUND). Other failures throw. */
export async function scanAtRegister(registerId: string, code: string): Promise<PosScanAnswer | null> {
    try {
        const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_REGISTER_SCAN(registerId, code), {
            params: params(),
        });
        const r = rec(res.data);
        const item = normalizeCatalogueItem(r.item);
        if (!item) return null;
        const piece = asRecord(r.piece);
        return {
            kind: text(r.kind) || 'VARIANT',
            item,
            piece:
                piece && str(piece.id)
                    ? {
                          id: text(piece.id),
                          code: text(piece.code),
                          status: text(piece.status),
                          here: bool(piece.here),
                      }
                    : null,
        };
    } catch (error) {
        if (statusOf(error) === 404) return null;
        throw error;
    }
}

export async function fetchApprovers(registerId: string): Promise<ApproverOption[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_REGISTER_APPROVERS(registerId), {
        params: params(),
    });
    return records(rec(res.data).approvers)
        .map((a) => ({ user_id: text(a.user_id), full_name: text(a.full_name) }))
        .filter((a) => a.user_id !== '');
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function openSession(body: OpenSessionBody): Promise<SessionView> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_SESSIONS, body, {
        params: params(),
    });
    return normalizeSession(res.data);
}

export async function fetchSession(sessionId: string): Promise<SessionView> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_SESSION_BY_ID(sessionId), {
        params: params(),
    });
    return normalizeSession(res.data);
}

export interface SessionFilters {
    registerId?: string;
    locationId?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
}

export async function fetchSessions(filters: SessionFilters): Promise<Paged<SessionRow>> {
    const pageSize = filters.pageSize ?? 50;
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_SESSIONS, {
        params: params({ ...filters, page: filters.page ?? 0, pageSize }),
    });
    return paged(res.data, 'sessions', normalizeSessionRow, pageSize);
}

export async function fetchSessionSales(
    sessionId: string,
    page = 0,
    pageSize = 50
): Promise<Paged<SaleRow>> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_SESSION_SALES(sessionId), {
        params: params({ page, pageSize }),
    });
    return paged(res.data, 'sales', normalizeSaleRow, pageSize);
}

export async function addCashMovement(sessionId: string, body: CashMovementBody): Promise<SessionView> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_SESSION_CASH(sessionId), body, {
        params: params(),
    });
    return normalizeSession(res.data);
}

export async function closeSession(sessionId: string, body: CloseSessionBody): Promise<SessionView> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_SESSION_CLOSE(sessionId), body, {
        params: params(),
    });
    return normalizeSession(res.data);
}

export async function lookupCustomer(sessionId: string, phone: string): Promise<CustomerLookup> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_CUSTOMER_LOOKUP, {
        params: params({ sessionId, phone }),
    });
    const r = rec(res.data);
    return { found: bool(r.found), name: str(r.name) };
}

// ─── Quote, sale, bill book, receipt ─────────────────────────────────────────

export async function quoteBill(body: QuoteRequest): Promise<Quote> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_QUOTE, body, { params: params() });
    return normalizeQuote(res.data);
}

export async function createSale(body: SaleRequest): Promise<SaleAnswer> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_SALES, body, { params: params() });
    return normalizeSaleAnswer(res.data);
}

export async function createBillBookEntry(body: BillBookRequest): Promise<SaleAnswer> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_BILL_BOOK, body, {
        params: params(),
    });
    return normalizeSaleAnswer(res.data);
}

export async function fetchReceipt(orderId: string): Promise<Receipt> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_SALE_RECEIPT(orderId), {
        params: params(),
    });
    return normalizeReceipt(res.data);
}

export async function lookupSales(sessionId: string, q: string): Promise<SaleRow[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_SALES_LOOKUP, {
        params: params({ sessionId, q }),
    });
    return records(rec(res.data).sales).map(normalizeSaleRow);
}

export async function fetchSale(orderId: string, sessionId: string): Promise<SaleDetail> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_SALE_BY_ID(orderId), {
        params: params({ sessionId }),
    });
    return normalizeSaleDetail(res.data);
}

export async function voidSale(orderId: string, body: VoidBody): Promise<SaleAnswer> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_SALE_VOID(orderId), body, {
        params: params(),
    });
    return normalizeSaleAnswer(res.data);
}

export async function changeTender(orderId: string, tenderId: string, body: TenderChangeBody): Promise<SaleAnswer> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_TENDER_CHANGE(orderId, tenderId), body, {
        params: params(),
    });
    return normalizeSaleAnswer(res.data);
}

// ─── Counter returns ─────────────────────────────────────────────────────────

export async function previewPosReturn(body: {
    session_id: string;
    order_id: string;
    lines: Pick<PosReturnLineRequest, 'order_line_id' | 'quantity'>[];
}): Promise<PosReturnPreview> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_RETURN_PREVIEW, body, {
        params: params(),
    });
    const r = rec(res.data);
    return {
        returnable: records(r.returnable).map((x) => ({
            order_line_id: text(x.order_line_id),
            returnable: money(x.returnable),
        })),
        warnings: strings(r.warnings),
        credit_estimate: num(r.credit_estimate),
        needs_approval: strings(r.needs_approval),
    };
}

export async function createPosReturn(body: PosReturnBody): Promise<PosReturnAnswer> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_POS_RETURNS, body, { params: params() });
    const r = rec(res.data);
    const refund = asRecord(r.refund);
    return {
        return_id: text(r.return_id),
        return_number: str(r.return_number),
        credit_note_id: str(r.credit_note_id),
        credit_note_number: str(r.credit_note_number),
        credit: money(r.credit),
        refund: refund
            ? {
                  id: text(refund.id),
                  method: text(refund.method),
                  amount: money(refund.amount),
                  status: text(refund.status),
              }
            : null,
        exchange_credit: num(r.exchange_credit),
    };
}

// ─── Settings and bill books ─────────────────────────────────────────────────

export async function fetchPosSettings(): Promise<PosSettings> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_POS_SETTINGS, { params: params() });
    return normalizeSettings(res.data);
}

export async function savePosSettings(body: {
    cashier_discount_percent: string;
    cash_refund_limit: string;
    cash_variance_limit: string;
}): Promise<PosSettings> {
    const res = await authenticatedAxiosInstance.put<unknown>(COMMERCE_POS_SETTINGS, body, { params: params() });
    return normalizeSettings(res.data);
}

export async function fetchDocumentSeries(): Promise<DocumentSeries[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_DOCUMENT_SERIES, {
        params: params({ page: 0, size: 100 }),
    });
    return asPage<unknown>(res.data, 100)
        .content.map(normalizeSeries)
        .filter((s): s is DocumentSeries => s !== null);
}

export async function createBillBook(body: BillBookCreateBody): Promise<DocumentSeries | null> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_DOCUMENT_SERIES, body, {
        params: params(),
    });
    return normalizeSeries(res.data);
}
