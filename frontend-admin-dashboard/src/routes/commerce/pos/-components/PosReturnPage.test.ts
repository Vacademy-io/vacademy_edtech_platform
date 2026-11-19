/** Counter return settle rules of the server (B2): reference only for UPI and bank transfer. */
import { describe, expect, it } from 'vitest';
import { EMPTY_PICK, pickProblem, previewSettle, returnAttemptScope, settleBody, toReturnLines, typeLengthPick, typesLength } from './PosReturnPage';

describe('counter return bodies', () => {
    it('settle: EXCHANGE alone, CASH without a reference, UPI and bank transfer with one', () => {
        expect(settleBody('EXCHANGE', 'X')).toEqual({ kind: 'EXCHANGE' });
        expect(settleBody('CASH', 'R1')).toEqual({ kind: 'REFUND', method: 'CASH' });
        expect(settleBody('UPI', 'UPI 4411')).toEqual({ kind: 'REFUND', method: 'UPI', reference: 'UPI 4411' });
        expect(settleBody('BANK_TRANSFER', null)).toEqual({ kind: 'REFUND', method: 'BANK_TRANSFER' });
    });

    it('preview: the method alone, no placeholder reference (the server preview takes UPI/bank without one)', () => {
        expect(previewSettle('UPI')).toEqual({ kind: 'REFUND', method: 'UPI' });
        expect(previewSettle('BANK_TRANSFER')).toEqual({ kind: 'REFUND', method: 'BANK_TRANSFER' });
        expect(previewSettle('EXCHANGE')).toEqual({ kind: 'EXCHANGE' });
    });

    it('an unanswered return is kept per bill', () => {
        expect(returnAttemptScope('o-1')).toBe('return.o-1');
        expect(returnAttemptScope('o-1')).not.toBe(returnAttemptScope('o-2'));
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

describe('counter return of part of a length (WP-44 FA5)', () => {
    const cloth = {
        order_line_id: 'c',
        line_no: 1,
        variant_id: 'v-cloth',
        sku: 'CLOTH-1',
        name: 'Cotton cloth',
        variant_label: null,
        unit: 'MTR',
        qty_scale: 10,
        quantity: 34,
        unit_price: 12.34,
        mrp: null,
        discount: 0,
        taxable_value: 0,
        tax_rate: null,
        tax_amount: 0,
        line_total: 419.56,
        piece_ids: [],
        piece_codes: [],
        qty_returned: 0,
        returnable: 34,
    };

    it('1.2 m typed as resaleable sends 12', () => {
        expect(typesLength(cloth)).toBe(true);
        const pick = typeLengthPick(EMPTY_PICK, 'good', '1.2', cloth);
        expect(pickProblem(pick, cloth)).toBeNull();
        expect(toReturnLines([cloth], { c: pick })).toEqual([{ order_line_id: 'c', quantity: 12, condition: 'RESALEABLE' }]);
    });

    it('extra decimals and more than the bill are refused, never rounded', () => {
        const fine = typeLengthPick(EMPTY_PICK, 'good', '1.25', cloth);
        expect(pickProblem(fine, cloth)).toBe('decimals');
        expect(toReturnLines([cloth], { c: fine })).toEqual([]);
        const split = typeLengthPick(typeLengthPick(EMPTY_PICK, 'good', '3', cloth), 'damaged', '0.5', cloth);
        expect(pickProblem(split, cloth)).toBe('tooMuch');
        const ok = typeLengthPick(typeLengthPick(EMPTY_PICK, 'good', '1', cloth), 'damaged', '0.2', cloth);
        expect(toReturnLines([cloth], { c: ok })).toEqual([
            { order_line_id: 'c', quantity: 10, condition: 'RESALEABLE' },
            { order_line_id: 'c', quantity: 2, condition: 'DAMAGED' },
        ]);
    });

    it('pieces and counted goods keep the steppers', () => {
        expect(typesLength({ ...cloth, qty_scale: 1 })).toBe(false);
        expect(typesLength({ ...cloth, piece_ids: ['p1'] })).toBe(false);
    });
});
