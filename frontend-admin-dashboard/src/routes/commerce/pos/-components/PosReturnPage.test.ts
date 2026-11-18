/** Counter return settle rules of the server (B2): reference only for UPI and bank transfer. */
import { describe, expect, it } from 'vitest';
import { settleBody, toReturnLines } from './PosReturnPage';

describe('counter return bodies', () => {
    it('settle: EXCHANGE alone, CASH without a reference, UPI and bank transfer with one', () => {
        expect(settleBody('EXCHANGE', 'X')).toEqual({ kind: 'EXCHANGE' });
        expect(settleBody('CASH', 'R1')).toEqual({ kind: 'REFUND', method: 'CASH' });
        expect(settleBody('UPI', 'UPI 4411')).toEqual({ kind: 'REFUND', method: 'UPI', reference: 'UPI 4411' });
        expect(settleBody('BANK_TRANSFER', null)).toEqual({ kind: 'REFUND', method: 'BANK_TRANSFER' });
    });

    it('lines: one entry per line and condition; pieces by id', () => {
        const line = (id: string, pieces: string[] = []) => ({
            order_line_id: id,
            line_no: 1,
            variant_id: 'v',
            sku: null,
            name: 'Steel bottle',
            variant_label: null,
            unit: null,
            qty_scale: 1,
            quantity: 3,
            unit_price: 450,
            mrp: null,
            discount: 0,
            taxable_value: 0,
            tax_rate: null,
            tax_amount: 0,
            line_total: 1350,
            piece_ids: pieces,
            piece_codes: pieces.map((p) => `P-${p}`),
            qty_returned: 0,
            returnable: 3,
        });
        expect(
            toReturnLines([line('a'), line('b', ['p1', 'p2'])], {
                a: { good: 1, damaged: 1, pieces: {} },
                b: { good: 0, damaged: 0, pieces: { p1: 'RESALEABLE', p2: 'DAMAGED' } },
            })
        ).toEqual([
            { order_line_id: 'a', quantity: 1, condition: 'RESALEABLE' },
            { order_line_id: 'a', quantity: 1, condition: 'DAMAGED' },
            { order_line_id: 'b', quantity: 1, condition: 'RESALEABLE', piece_ids: ['p1'] },
            { order_line_id: 'b', quantity: 1, condition: 'DAMAGED', piece_ids: ['p2'] },
        ]);
    });
});
