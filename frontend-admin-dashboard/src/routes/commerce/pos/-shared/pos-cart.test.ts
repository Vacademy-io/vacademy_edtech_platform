/** Contract §7.4: the bill reducer, one row of the table per test (plus the request builders). */
import { describe, expect, it } from 'vitest';
import { type CartState, cartReducer, cartStep, emptyCart, toQuoteRequest, toSaleRequest } from './pos-cart';
import { hose, item, piece, scarf } from './pos-test-fixtures';

const run = (events: Parameters<typeof cartStep>[1][], from: CartState = emptyCart()) =>
    events.reduce((state, event) => cartReducer(state, event), from);

describe('ADD_VARIANT', () => {
    it('a PIECE + tracked item asks for its piece label', () => {
        const result = cartStep(emptyCart(), { type: 'ADD_VARIANT', item: scarf() });
        expect(result.refusal).toBe('scanPieceLabel');
        expect(result.state.lines).toHaveLength(0);
    });

    it('a new line starts at one step; the same variant again adds a step (one line per variant)', () => {
        const state = run([
            { type: 'ADD_VARIANT', item: item() },
            { type: 'ADD_VARIANT', item: item() },
        ]);
        expect(state.lines).toHaveLength(1);
        expect(state.lines[0]?.quantity).toBe(2);
        expect(state.lines[0]?.lineRef).toBe('l1');
    });

    it('a measured item opens the length box instead of adding a step', () => {
        const first = cartStep(emptyCart(), { type: 'ADD_VARIANT', item: hose() });
        expect(first.state.lines[0]?.quantity).toBe(5);
        expect(first.openLengthFor).toBe('l1');
        const again = cartStep(first.state, { type: 'ADD_VARIANT', item: hose() });
        expect(again.state.lines[0]?.quantity).toBe(5);
        expect(again.openLengthFor).toBe('l1');
    });

    it('line refs are l1, l2… in the order lines were added and are not reused', () => {
        const state = run([
            { type: 'ADD_VARIANT', item: item() },
            { type: 'ADD_VARIANT', item: item({ variant_id: 'ps-2', sku: 'X-2' }) },
            { type: 'REMOVE_LINE', lineRef: 'l1' },
            { type: 'ADD_VARIANT', item: item({ variant_id: 'ps-3', sku: 'X-3' }) },
        ]);
        expect(state.lines.map((l) => l.lineRef)).toEqual(['l2', 'l3']);
    });
});

describe('ADD_PIECE', () => {
    it('a piece not at this location is refused', () => {
        expect(cartStep(emptyCart(), { type: 'ADD_PIECE', item: scarf(), piece: piece('P1', { here: false }) }).refusal).toBe(
            'notHere'
        );
    });

    it('pieces of one variant share its line; a piece already on the bill is refused', () => {
        const state = run([
            { type: 'ADD_PIECE', item: scarf(), piece: piece('P1') },
            { type: 'ADD_PIECE', item: scarf(), piece: piece('P2') },
        ]);
        expect(state.lines).toHaveLength(1);
        expect(state.lines[0]?.quantity).toBe(2);
        expect(state.lines[0]?.pieceCodes).toEqual(['P1', 'P2']);
        const twice = cartStep(state, { type: 'ADD_PIECE', item: scarf(), piece: piece('P2') });
        expect(twice.refusal).toBe('alreadyOnBill');
        expect(twice.state).toBe(state);
    });

    it('REMOVE_PIECE drops the piece and the quantity; the last piece removes the line', () => {
        let state = run([
            { type: 'ADD_PIECE', item: scarf(), piece: piece('P1') },
            { type: 'ADD_PIECE', item: scarf(), piece: piece('P2') },
            { type: 'REMOVE_PIECE', lineRef: 'l1', pieceId: 'id-P1' },
        ]);
        expect(state.lines[0]?.pieceCodes).toEqual(['P2']);
        expect(state.lines[0]?.quantity).toBe(1);
        state = cartReducer(state, { type: 'REMOVE_PIECE', lineRef: 'l1', pieceId: 'id-P2' });
        expect(state.lines).toHaveLength(0);
    });
});

describe('SET_QUANTITY', () => {
    const withHose = () => run([{ type: 'ADD_VARIANT', item: hose() }]);
    it('takes a multiple of the step within 1 step .. 100000', () => {
        expect(cartReducer(withHose(), { type: 'SET_QUANTITY', lineRef: 'l1', quantity: 25 }).lines[0]?.quantity).toBe(25);
        expect(cartStep(withHose(), { type: 'SET_QUANTITY', lineRef: 'l1', quantity: 27 }).refusal).toBe('quantityStep');
        expect(cartStep(withHose(), { type: 'SET_QUANTITY', lineRef: 'l1', quantity: 0 }).refusal).toBe('quantityRange');
        expect(cartStep(withHose(), { type: 'SET_QUANTITY', lineRef: 'l1', quantity: 100_005 }).refusal).toBe(
            'quantityRange'
        );
    });

    it('a piece line changes only by scanning or removing pieces', () => {
        const state = run([{ type: 'ADD_PIECE', item: scarf(), piece: piece('P1') }]);
        expect(cartStep(state, { type: 'SET_QUANTITY', lineRef: 'l1', quantity: 2 }).refusal).toBe('pieceLine');
    });
});

describe('discounts, customer, exchange, marks', () => {
    it('a line discount is 0..gross; a bill discount needs a value above 0 (percent ≤ 100)', () => {
        const state = run([{ type: 'ADD_VARIANT', item: item() }]);
        expect(cartReducer(state, { type: 'SET_LINE_DISCOUNT', lineRef: 'l1', amount: 50 }).lines[0]?.lineDiscount).toBe(50);
        expect(cartStep(state, { type: 'SET_LINE_DISCOUNT', lineRef: 'l1', amount: 450.01 }).refusal).toBe('discountTooHigh');
        expect(cartStep(state, { type: 'SET_BILL_DISCOUNT', discount: { kind: 'PERCENT', value: 101 } }).refusal).toBe(
            'discountTooHigh'
        );
        const billed = cartReducer(state, {
            type: 'SET_BILL_DISCOUNT',
            discount: { kind: 'AMOUNT', value: 20 },
            reason: 'Regular customer',
        });
        expect(billed.billDiscount).toEqual({ kind: 'AMOUNT', value: 20 });
        expect(billed.discountReason).toBe('Regular customer');
    });

    it('SET_CUSTOMER merges, SET_EXCHANGE sets, MARK_LINE marks, CLEAR empties', () => {
        let state = run([{ type: 'ADD_VARIANT', item: item() }]);
        state = cartReducer(state, { type: 'SET_CUSTOMER', customer: { phone: '9000000000' } });
        state = cartReducer(state, { type: 'SET_CUSTOMER', customer: { name: 'Test Buyer' } });
        expect(state.customer).toMatchObject({ phone: '9000000000', name: 'Test Buyer' });
        state = cartReducer(state, { type: 'SET_EXCHANGE', exchange: { returnId: 'r-1', number: 'RET-1', credit: 300 } });
        expect(state.exchange?.credit).toBe(300);
        state = cartReducer(state, { type: 'MARK_LINE', lineRef: 'l1', mark: { code: 'IN_ONLINE_CHECKOUT', time: '14:30' } });
        expect(state.lines[0]?.mark).toEqual({ code: 'IN_ONLINE_CHECKOUT', time: '14:30' });
        expect(cartReducer(state, { type: 'CLEAR' })).toEqual(emptyCart());
    });

    it('SET_PRICE takes the server price and marks the line', () => {
        const state = cartReducer(run([{ type: 'ADD_VARIANT', item: item() }]), {
            type: 'SET_PRICE',
            lineRef: 'l1',
            unitPrice: 499,
        });
        expect(state.lines[0]?.unitPrice).toBe(499);
        expect(state.lines[0]?.mark?.code).toBe('PRICE_CHANGED');
    });
});

describe('requests', () => {
    const bill = () =>
        run([
            { type: 'ADD_PIECE', item: scarf(), piece: piece('P1') },
            { type: 'ADD_VARIANT', item: item() },
            { type: 'ADD_VARIANT', item: item() },
            { type: 'ADD_VARIANT', item: hose() },
            { type: 'SET_QUANTITY', lineRef: 'l3', quantity: 25 },
            { type: 'SET_LINE_DISCOUNT', lineRef: 'l2', amount: 10 },
            { type: 'SET_DISCOUNT_REASON', reason: 'Regular customer' },
        ]);

    it('toQuoteRequest: one line per variant, base units, piece_ids only on piece lines, prices echoed', () => {
        const body = toQuoteRequest(bill(), 'sess-1');
        expect(body.session_id).toBe('sess-1');
        expect(body.lines).toEqual([
            { line_ref: 'l1', variant_id: 'ps-scarf', quantity: 1, piece_ids: ['id-P1'], unit_price: '1200.00' },
            { line_ref: 'l2', variant_id: 'ps-bottle', quantity: 2, line_discount: '10.00', unit_price: '450.00' },
            { line_ref: 'l3', variant_id: 'ps-hose', quantity: 25, unit_price: '200.00' },
        ]);
        expect(body.customer).toBeUndefined();
        expect(body.discount_reason).toBe('Regular customer');
    });

    it('toSaleRequest: tenders and notify, exchange with remainder, a phone makes it a named buyer', () => {
        let state = cartReducer(bill(), { type: 'SET_CUSTOMER', customer: { phone: '90000 00000' } });
        state = cartReducer(state, { type: 'SET_EXCHANGE', exchange: { returnId: 'r-1', number: null, credit: 5000 } });
        const body = toSaleRequest(state, 'sess-1', [{ mode: 'CASH', amount: '10.00' }], true, {
            method: 'CASH',
            reference: null,
        });
        expect(body.tenders).toEqual([{ mode: 'CASH', amount: '10.00' }]);
        expect(body.notify).toBe(true);
        expect(body.customer).toEqual({ phone: '9000000000' });
        expect(body.exchange).toEqual({ return_id: 'r-1', remainder_refund: { method: 'CASH', reference: null } });
        expect(body).not.toHaveProperty('client_request_id');
        expect(body).not.toHaveProperty('approval');
    });
});
