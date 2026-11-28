import { AxiosError, type AxiosResponse } from 'axios';
import type { CatalogueItem, Quote, Receipt, SaleAnswer, ScanPiece, SessionView } from './pos-types';

/** Neutral sample data for the counter's tests (no real shop, product or place names). */

export const item = (over: Partial<CatalogueItem> = {}): CatalogueItem => ({
    variant_id: 'ps-bottle',
    product_id: 'p-bottle',
    sku: 'BTL-1',
    label_code: 'V-BOTTLE',
    barcode: '8900000000017',
    names: { en: 'Steel bottle', hi: 'स्टील की बोतल' },
    variant_label: { en: '1 litre', hi: '1 लीटर' },
    unit: null,
    qty_scale: 1,
    qty_step: 1,
    stock_mode: 'QUANTITY',
    tracked: true,
    unit_price: 450,
    mrp: 500,
    currency: 'INR',
    on_hand: 10,
    ...over,
});

export const scarf = (over: Partial<CatalogueItem> = {}): CatalogueItem =>
    item({
        variant_id: 'ps-scarf',
        product_id: 'p-scarf',
        sku: 'SCF-1',
        label_code: 'V-SCARF',
        barcode: null,
        names: { en: 'Cotton scarf', hi: 'सूती स्कार्फ़' },
        variant_label: { en: 'Blue', hi: 'नीला' },
        stock_mode: 'PIECE',
        unit_price: 1200,
        on_hand: 3,
        ...over,
    });

export const hose = (over: Partial<CatalogueItem> = {}): CatalogueItem =>
    item({
        variant_id: 'ps-hose',
        product_id: 'p-hose',
        sku: 'HSE-1',
        label_code: 'V-HOSE',
        barcode: null,
        names: { en: 'Garden hose', hi: 'बगीचे का पाइप' },
        variant_label: { en: 'Green', hi: 'हरा' },
        unit: 'm',
        qty_scale: 10,
        qty_step: 5,
        // The catalogue stores the price of ONE base unit: 20.00 per tenth of a metre = 200.00 a metre.
        unit_price: 20,
        on_hand: 250,
        ...over,
    });

export const piece = (code: string, over: Partial<ScanPiece> = {}): ScanPiece => ({
    id: `id-${code}`,
    code,
    status: 'IN_STOCK',
    here: true,
    ...over,
});

export const session = (over: Partial<SessionView> = {}): SessionView => ({
    id: 'sess-1',
    status: 'OPEN',
    register: { id: 'reg-1', code: 'C1', name: 'Front counter' },
    location: { id: 'loc-1', name: 'Main store' },
    cashier_user_id: 'u-cashier',
    cashier_name: 'Test Cashier',
    mine: true,
    opened_at: '2026-11-18T04:30:00Z',
    opening_cash: 500,
    opening_note: null,
    previous_counted_cash: null,
    closed_at: null,
    closed_by: null,
    expected_cash: null,
    counted_cash: null,
    variance: null,
    close_note: null,
    denominations: null,
    cash_movements: [],
    summary: null,
    z_report: null,
    next_actions: ['SELL', 'CLOSE', 'BILL_BOOK'],
    ...over,
});

export const quote = (total: number, lines: { ref: string; net: number }[] = []): Quote => ({
    lines: lines.map((l) => ({
        line_ref: l.ref,
        variant_id: 'v',
        quantity: 1,
        unit_price: l.net,
        gross: l.net,
        discount: 0,
        net: l.net,
        taxable_value: l.net,
        tax_rate: 5,
        tax_amount: 0,
    })),
    unavailable: [],
    changes: [],
    totals: { subtotal: total, discount: 0, tax: 0, round_off: 0, total },
    tax_rows: [{ rate: 5, taxable: total, cgst: 10, sgst: 10, igst: 0, cess: 0 }],
    discount_percent: 0,
    cashier_discount_percent: 5,
    needs_approval: [],
    exchange_credit: null,
});

export const receipt = (over: Partial<Receipt> = {}): Receipt => ({
    shop: { trade_name: 'Test Shop', legal_name: null, gstin: null, address_lines: ['1 Test Road', 'Test City 100001'], phone: null },
    location: { name: 'Main store', state_code: 'ZZ' },
    register: { code: 'C1', name: 'Front counter' },
    document: {
        type: 'TAX_INVOICE',
        number: 'C1/26-0001',
        date: '2026-11-18',
        issued_at: '2026-11-18T05:00:00Z',
        cancelled: false,
        cancel_reason: null,
        paper: false,
    },
    order_number: 'ORD-1',
    customer: { name: null, phone_last4: null, buyer_gstin: null, buyer_legal_name: null },
    lines: [],
    tax_rows: [],
    totals: { subtotal: 900, discount: 0, tax: 0, round_off: 0, total: 900 },
    amount_in_words: null,
    tenders: [{ mode: 'CASH', amount: 900, reference: null, status: 'RECEIVED' }],
    cash_tendered: 1000,
    change: 100,
    qr_text: 'C1/26-0001',
    ...over,
});

export const saleAnswer = (): SaleAnswer => ({
    sale: {
        order_id: 'o-1',
        order_number: 'ORD-1',
        channel: 'POS',
        status: 'DELIVERED',
        session_id: 'sess-1',
        register_id: 'reg-1',
        location_id: 'loc-1',
        document: { id: 'inv-1', number: 'C1/26-0001', type: 'TAX_INVOICE', date: '2026-11-18', cancelled: false },
        customer: null,
        lines: [],
        totals: { subtotal: 900, discount: 0, tax: 0, round_off: 0, total: 900, amount_paid: 900, amount_refunded: 0 },
        tenders: [],
        change_due: 100,
        returns: [],
        next_actions: ['VOID'],
    },
    receipt: receipt(),
    replayed: false,
});

/** An axios error as the server answers it: `CODE: sentence` in `message`. */
export function serverError(status: number, message: string): AxiosError {
    const response = {
        status,
        data: { message },
        headers: {},
        statusText: 'Error',
        config: {},
    } as unknown as AxiosResponse;
    return new AxiosError(message, String(status), undefined, undefined, response);
}

/** No answer reached the browser (offline, timeout). */
export const networkError = (): AxiosError => new AxiosError('Network Error', 'ERR_NETWORK');
