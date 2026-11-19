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
    firstQuantity,
    offStep,
    overrideBasePrice,
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
/** The server's price is per base unit: 12.34 per 10 cm is ₹123.40 a metre (WP-44 FA3). */
const cloth: LineSource = {
    variantId: 'ps-cloth',
    sku: 'CLOTH-1',
    name: 'Cotton cloth',
    variantName: null,
    qtyScale: 10,
    unit: 'MTR',
    listPrice: 12.34,
};
const linen: LineSource = { ...cloth, variantId: 'ps-linen', sku: 'LINEN-1', name: 'Linen cloth', qtyStep: 5, listPrice: 20 };

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
        // 25 × ₹12.34 in paise: ₹308.50, not ₹123.40 × 2.5 read as per-base-unit (₹30.85).
        expect(estimateTotal([line({ ...cloth, quantity: '2.5' })])).toBe(308.5);
        expect(estimateTotal([line({ ...cloth, quantity: '3.4' })])).toBe(419.56);
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

describe('measured goods on a staff order (WP-44 FA3)', () => {
    it('"Price for this order" is typed per metre and sent per 10 cm', () => {
        const typed = line({ ...cloth, quantity: '2.5', priceOverride: '123.40' });
        expect(overrideBasePrice(typed)).toBe(12.34);
        expect(buildStaffOrderBody(filled({ lines: [typed] })).lines[0]).toEqual({
            variant_id: 'ps-cloth',
            quantity: 25,
            unit_price_override: 12.34,
        });
        expect(estimateTotal([typed])).toBe(308.5);
    });

    it('a price per metre that does not split into 10 equal paise is refused, not rounded', () => {
        const typed = line({ ...cloth, priceOverride: '123.45' });
        expect(overrideBasePrice(typed)).toBe('notDivisible');
        expect(validateNewOrder(filled({ lines: [typed] }))['line.k1.price']).toBe('orders.new.problems.priceNotDivisible');
        expect(buildStaffOrderBody(filled({ lines: [typed] })).lines[0]).not.toHaveProperty('unit_price_override');
        expect(overrideBasePrice(line({ ...cloth, priceOverride: '123.405' }))).toBe('invalid');
        // Counted goods: the typed price is the price.
        expect(overrideBasePrice(line({ priceOverride: '450' }))).toBe(450);
    });

    it('a length off the sale step is refused before the server says QUANTITY_STEP', () => {
        expect(offStep(line({ ...linen, quantity: '2.3' }))).toBe(true);
        expect(offStep(line({ ...linen, quantity: '2.5' }))).toBe(false);
        expect(validateNewOrder(filled({ lines: [line({ ...linen, quantity: '2.3' })] }))['line.k1.quantity']).toBe(
            'orders.new.problems.quantityStep'
        );
        expect(validateNewOrder(filled({ lines: [line({ ...linen, quantity: '2.55' })] }))['line.k1.quantity']).toBe(
            'orders.new.problems.quantity'
        );
    });

    it('a new measured line starts at 1 m when 1 m is on the step, else one step', () => {
        expect(firstQuantity(cloth)).toBe('1');
        expect(firstQuantity(linen)).toBe('1');
        expect(firstQuantity({ qtyScale: 10, qtyStep: 3 })).toBe('0.3');
        expect(firstQuantity({ qtyScale: 1, qtyStep: 1 })).toBe('1');
        expect(addItem([], { ...cloth, qtyStep: 3 })?.[0]?.quantity).toBe('0.3');
    });
});
