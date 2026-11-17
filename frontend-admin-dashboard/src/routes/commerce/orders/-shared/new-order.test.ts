/** The new staff order form: body shape, exchange, quantities and checks. */
import { describe, expect, it } from 'vitest';
import {
    type LineSource,
    type NewOrderForm,
    type NewOrderLine,
    addItem,
    addPiece,
    buildStaffOrderBody,
    emptyNewOrder,
    estimateTotal,
    lineStoredQuantity,
    mobileDigits,
    needsRemainderRefund,
    prefillCustomer,
    validateNewOrder,
} from './new-order';

const scarf: LineSource = {
    variantId: 'ps-scarf',
    sku: 'SCARF-1',
    name: 'Cotton scarf',
    variantName: 'Blue',
    qtyScale: 1,
    unit: null,
    listPrice: 500,
};
const cloth: LineSource = {
    variantId: 'ps-cloth',
    sku: 'CLOTH-1',
    name: 'Cotton cloth',
    variantName: null,
    qtyScale: 10,
    unit: 'm',
    listPrice: 200,
};

const line = (patch: Partial<NewOrderLine> = {}): NewOrderLine => ({
    key: 'k1',
    ...scarf,
    quantity: '2',
    priceOverride: '',
    pieceCodes: [],
    ...patch,
});

const address = {
    name: 'Test Customer',
    phone: '',
    line1: '12 Test Road',
    line2: '',
    landmark: '',
    city: 'Test City',
    state_code: '99',
    pincode: '100001',
};

const filled = (patch: Partial<NewOrderForm> = {}): NewOrderForm => ({
    ...emptyNewOrder(),
    phone: '+91 90000 00001',
    name: 'Test Customer',
    lines: [line()],
    shipping: { ...address },
    ...patch,
});

describe('buildStaffOrderBody', () => {
    it('ships to an address with billing the same, shipping charged by default', () => {
        const body = buildStaffOrderBody(filled({ couponCode: ' SAVE10 ', note: ' Gift wrap ' }));
        expect(body).toEqual({
            customer: { phone: '+91 90000 00001', name: 'Test Customer' },
            lines: [{ variant_id: 'ps-scarf', quantity: 2 }],
            hand_over_now: false,
            rest_on_credit: false,
            shipping_address: {
                name: 'Test Customer',
                line1: '12 Test Road',
                city: 'Test City',
                state_code: '99',
                pincode: '100001',
            },
            billing_address: {
                name: 'Test Customer',
                line1: '12 Test Road',
                city: 'Test City',
                state_code: '99',
                pincode: '100001',
            },
            charge_shipping: true,
            coupon_code: 'SAVE10',
            customer_note: 'Gift wrap',
        });
    });

    it('hand over now: no address, pieces sent, price override and tenders on credit', () => {
        const body = buildStaffOrderBody(
            filled({
                handOverNow: true,
                shipping: { ...address, line1: '' },
                lines: [line({ pieceCodes: ['P-1', 'P-2'], quantity: '2', priceOverride: '450' })],
                tenders: [{ key: 't1', mode: 'UPI', amount: '300', reference: ' UTR1 ' }],
                restOnCredit: true,
            })
        );
        expect(body.shipping_address).toBeUndefined();
        expect(body.charge_shipping).toBeUndefined();
        expect(body.lines).toEqual([
            { variant_id: 'ps-scarf', quantity: 2, unit_price_override: 450, piece_codes: ['P-1', 'P-2'] },
        ]);
        expect(body.tenders).toEqual([{ mode: 'UPI', amount: 300, reference: 'UTR1' }]);
        expect(body.rest_on_credit).toBe(true);
        expect(validateNewOrder(filled({ handOverNow: true, shipping: { ...address, line1: '' } }))).toEqual({});
    });

    it('a typed SKU goes as sku; pieces are dropped when the order is shipped', () => {
        const body = buildStaffOrderBody(
            filled({ lines: [line({ variantId: null, sku: 'BOTTLE-1', quantity: '1', pieceCodes: [] }), line({ key: 'k2', pieceCodes: ['P-9'] })] })
        );
        expect(body.lines).toEqual([
            { sku: 'BOTTLE-1', quantity: 1 },
            { variant_id: 'ps-scarf', quantity: 1 },
        ]);
    });

    it('measured goods are stored as the integer of the scale', () => {
        expect(lineStoredQuantity({ quantity: '2.5', qtyScale: 10, pieceCodes: [] })).toBe(25);
        expect(lineStoredQuantity({ quantity: '2.55', qtyScale: 10, pieceCodes: [] })).toBeNull();
        expect(lineStoredQuantity({ quantity: '1.5', qtyScale: 1, pieceCodes: [] })).toBeNull();
        expect(lineStoredQuantity({ quantity: '0', qtyScale: 1, pieceCodes: [] })).toBeNull();
        const body = buildStaffOrderBody(filled({ lines: [line({ ...cloth, quantity: '2.5' })] }));
        expect(body.lines[0]).toEqual({ variant_id: 'ps-cloth', quantity: 25 });
        expect(estimateTotal([line({ ...cloth, quantity: '2.5' })])).toBe(500);
    });

    it('an exchange sends the return and, when the credit is larger, the remainder refund', () => {
        const exchange = { returnId: 'ret-1', returnNumber: 'RT-1', credit: 1500 };
        const form = filled({ exchange, remainderMethod: 'UPI', remainderReference: ' UTR9 ' });
        expect(estimateTotal(form.lines)).toBe(1000);
        expect(needsRemainderRefund(form)).toBe(true);
        expect(buildStaffOrderBody(form).exchange).toEqual({
            return_id: 'ret-1',
            remainder_refund: { method: 'UPI', reference: 'UTR9' },
        });
        expect(validateNewOrder({ ...form, remainderMethod: '' }).remainderMethod).toBe(
            'orders.new.problems.remainderMethod'
        );
        const covered = filled({ exchange: { ...exchange, credit: 800 }, remainderMethod: 'UPI' });
        expect(needsRemainderRefund(covered)).toBe(false);
        expect(buildStaffOrderBody(covered).exchange).toEqual({ return_id: 'ret-1' });
    });
});

describe('validateNewOrder', () => {
    it('answers sentence keys per field', () => {
        const problems = validateNewOrder({
            ...emptyNewOrder(),
            phone: '12345',
            email: 'not-an-email',
            buyerGstin: 'BAD',
            shipping: { ...address, pincode: '012345', city: '' },
            tenders: [{ key: 't1', mode: 'CASH', amount: '0', reference: '' }],
        });
        expect(problems).toMatchObject({
            phone: 'orders.new.problems.phone',
            name: 'orders.new.problems.required',
            email: 'orders.new.problems.email',
            lines: 'orders.new.problems.noLines',
            'shipping.pincode': 'orders.new.problems.pincode',
            'shipping.city': 'orders.new.problems.required',
            buyerGstin: 'orders.new.problems.gstin',
            'tender.t1.amount': 'orders.new.problems.amount',
        });
        expect(validateNewOrder(filled())).toEqual({});
    });

    it('billing address is checked only when it differs', () => {
        expect(validateNewOrder(filled({ billingSame: false }))['billing.name']).toBe('orders.new.problems.required');
    });

    it('mobile numbers', () => {
        expect(mobileDigits('+91 98765-43210')).toBe('9876543210');
        expect(mobileDigits('09876543210')).toBe('9876543210');
        expect(mobileDigits('5876543210')).toBeNull();
    });
});

describe('adding items', () => {
    it('a product label adds a line, then counts up', () => {
        const once = addItem([], scarf)!;
        expect(once).toHaveLength(1);
        expect(addItem(once, scarf)![0]?.quantity).toBe('2');
    });

    it('a piece is added once, its line counts its pieces', () => {
        const first = addPiece([], scarf, 'P-1') as NewOrderLine[];
        const second = addPiece(first, scarf, 'P-2') as NewOrderLine[];
        expect(second[0]).toMatchObject({ pieceCodes: ['P-1', 'P-2'], quantity: '2' });
        expect(addPiece(second, scarf, 'p-1')).toBe('duplicate');
    });

    it('at most 50 lines', () => {
        let lines: NewOrderLine[] = [];
        for (let i = 0; i < 50; i += 1) lines = addItem(lines, { ...scarf, variantId: `ps-${i}` })!;
        expect(addItem(lines, { ...scarf, variantId: 'ps-new' })).toBeNull();
    });
});

describe('prefillCustomer', () => {
    it('fills only what is empty and takes the original shipping address', () => {
        const next = prefillCustomer(
            { ...emptyNewOrder(), name: 'Typed Name', handOverNow: true },
            { name: 'Old Name', phone: '9000000001', email: 'a@example.com', address: { city: 'Test City', pincode: '100001' } }
        );
        expect(next.name).toBe('Typed Name');
        expect(next.phone).toBe('9000000001');
        expect(next.email).toBe('a@example.com');
        expect(next.shipping.city).toBe('Test City');
        expect(next.handOverNow).toBe(false);
    });
});
