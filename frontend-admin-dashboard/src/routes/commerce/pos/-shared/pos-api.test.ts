/**
 * The normalisers read the server's real answers (WP-42 B1/B2 `PosDtos`): field names pinned
 * here so a rename on either side shows up as a failing test.
 */
import { describe, expect, it } from 'vitest';
import {
    normalizeQuote,
    normalizeRegister,
    normalizeSaleDetail,
    normalizeSaleRow,
    normalizeSession,
    normalizeSessionRow,
} from './pos-api';

describe('pos-api normalisers (server shapes)', () => {
    it('quote changes: new_unit_price is the price to echo, type is kept', () => {
        const quote = normalizeQuote({
            lines: [{ line_ref: 'l1', variant_id: 'v1', quantity: 2, unit_price: '499.00', net: '998.00' }],
            unavailable: [{ line_ref: 'l2', reason: 'NO_PRICE' }],
            changes: [
                {
                    line_ref: 'l1',
                    variant_id: 'v1',
                    type: 'PRICE_CHANGED',
                    reason: 'price moved',
                    old_unit_price: '450.00',
                    new_unit_price: '499.00',
                },
                { line_ref: 'l2', variant_id: 'v2', type: 'UNAVAILABLE', reason: 'NO_PRICE' },
            ],
            totals: { subtotal: '998.00', discount: '0', tax: '47.52', round_off: '0', total: '998.00' },
            tax_rows: [],
            needs_approval: ['POS_DISCOUNT'],
        });
        expect(quote.changes).toEqual([
            { line_ref: 'l1', type: 'PRICE_CHANGED', unit_price: 499 },
            { line_ref: 'l2', type: 'UNAVAILABLE', unit_price: null },
        ]);
        expect(quote.totals.total).toBe(998);
        expect(quote.needs_approval).toEqual(['POS_DISCOUNT']);
    });

    it('sale rows read tender_modes and created_at', () => {
        const row = normalizeSaleRow({
            order_id: 'o1',
            order_number: 'ORD-1',
            channel: 'POS',
            status: 'DELIVERED',
            invoice_number: 'C1/26-0001',
            document_date: '2026-11-18',
            total: 900,
            created_at: '2026-11-18T05:00:00.000+00:00',
            tender_modes: ['CASH', 'UPI'],
        });
        expect(row.modes).toEqual(['CASH', 'UPI']);
        expect(row.created_at).toBe('2026-11-18T05:00:00.000+00:00');
    });

    it('a register with no open session (JSON null) and a session view', () => {
        expect(
            normalizeRegister({ id: 'r1', code: 'C1', name: 'Front', status: 'ACTIVE', open_session: null, setup_warnings: [] })
                ?.open_session
        ).toBeNull();
        const session = normalizeSession({
            id: 's1',
            status: 'OPEN',
            register: { id: 'r1', code: 'C1', name: 'Front' },
            location: { id: 'l1', name: 'Main store' },
            mine: true,
            opening_cash: 500,
            denominations: { '500': 2 },
            summary: { expected_cash: '1500.00', by_mode: [{ mode: 'UPI', count: 1, amount: '450.00' }] },
            next_actions: ['SELL', 'CLOSE'],
        });
        expect(session.summary?.expected_cash).toBe(1500);
        expect(session.summary?.by_mode[0]).toEqual({ mode: 'UPI', count: 1, amount: 450 });
        expect(session.denominations).toEqual({ '500': 2 });
    });

    it('session rows name the cashier (server field cashier_name, G2)', () => {
        const row = normalizeSessionRow({
            id: 's1',
            status: 'CLOSED',
            register_code: 'C1',
            location_name: 'Main store',
            cashier_user_id: 'u1',
            cashier_name: 'Test Cashier',
            bills_count: 3,
            bills_total: '1350.00',
            variance: '0.00',
        });
        expect(row.cashier_name).toBe('Test Cashier');
        expect(normalizeSessionRow({ id: 's2', cashier_name: null }).cashier_name).toBeNull();
    });

    it('the day report keeps paid refunds and refunds not paid yet apart', () => {
        const session = normalizeSession({
            id: 's1',
            status: 'CLOSED',
            register: { id: 'r1', code: 'C1', name: 'Front' },
            location: { id: 'l1', name: 'Main store' },
            z_report: {
                refunds: [{ method: 'CASH', count: 1, amount: '200.00' }],
                refunds_pending: [{ method: 'UPI', count: 1, amount: '750.00' }],
            },
        });
        expect(session.z_report?.refunds).toEqual([{ method: 'CASH', count: 1, amount: 200 }]);
        expect(session.z_report?.refunds_pending).toEqual([{ method: 'UPI', count: 1, amount: 750 }]);
    });

    it('sale detail: dates, tenders, next actions', () => {
        const detail = normalizeSaleDetail({
            order_id: 'o1',
            order_number: 'ORD-1',
            status: 'DELIVERED',
            document: { id: 'i1', number: 'C1/26-0001', type: 'TAX_INVOICE', date: '2026-11-18', cancelled: false },
            lines: [{ order_line_id: 'ol1', line_no: 1, quantity: 2, qty_scale: 1, returnable: 2, piece_ids: [], piece_codes: [] }],
            totals: { total: '900.00', amount_paid: '900.00', amount_refunded: '0' },
            tenders: [{ id: 't1', mode: 'CASH', amount: '900.00', status: 'RECEIVED', cash_tendered: '1000.00' }],
            next_actions: ['VOID', 'CHANGE_TENDER', 'RETURN'],
        });
        expect(detail.document?.date).toBe('2026-11-18');
        expect(detail.tenders[0]?.cash_tendered).toBe(1000);
        expect(detail.lines[0]?.returnable).toBe(2);
        expect(detail.next_actions).toEqual(['VOID', 'CHANGE_TENDER', 'RETURN']);
    });
});
