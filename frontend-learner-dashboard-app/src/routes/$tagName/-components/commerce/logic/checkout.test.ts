import { describe, expect, it } from 'vitest';
import { CommerceApiError } from '../api/client';
import type { KeyValueStorage } from '../state/session';
import {
    EMPTY_FORM,
    attemptFor,
    attemptKey,
    buildCheckoutBody,
    cartHash,
    checkoutErrorAction,
    isGstin,
    normaliseMobile,
    orderStage,
    pollDelay,
    readOrderFragment,
    readOrderLinkFragment,
    renewAttempt,
    typedMobile,
    validateForm,
    withPlaced,
} from './checkout';

const memory = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

const line = (variantId: string, quantity = 1) => ({
    variantId,
    slug: 'x',
    name: 'X',
    variantLabel: null,
    imageUrl: null,
    quantity,
    qtyScale: 1,
    qtyStep: 1,
    unit: 'PCS',
    piece: false,
    unitPrice: 100,
    addedAt: 0,
});

const counter = () => {
    let n = 0;
    return () => `cx-id-${(n += 1)}-abcdef`;
};

const err = (status: number, code: string, details: Record<string, unknown> | null = null) =>
    new CommerceApiError(status === 429 ? 'rate_limited' : status === 409 ? 'conflict' : status >= 500 ? 'server' : 'invalid', status, code, '', null, details);

describe('fields', () => {
    it('reads an Indian mobile however it is typed', () => {
        expect(normaliseMobile('+91 98765 43210')).toBe('9876543210');
        expect(normaliseMobile('09876543210')).toBe('9876543210');
        expect(normaliseMobile('919876543210')).toBe('9876543210');
        expect(normaliseMobile('5876543210')).toBeNull();
        expect(normaliseMobile('98765')).toBeNull();
        expect(typedMobile('+91 98765-43210')).toBe('9876543210');
        expect(typedMobile('98765abc4')).toBe('987654');
    });

    it('checks the form in page order, e-mail only when required', () => {
        expect(validateForm(EMPTY_FORM, { emailRequired: false }).map(([f]) => f)).toEqual(['phone', 'pincode', 'city', 'stateCode', 'name', 'line1']);
        expect(validateForm(EMPTY_FORM, { emailRequired: true }).map(([f]) => f)).toContain('email');
        const good = { ...EMPTY_FORM, phone: '9876543210', name: 'Asha', pincode: '221001', city: 'Varanasi', stateCode: '09', line1: '12 Ghat Road' };
        expect(validateForm(good, { emailRequired: false })).toEqual([]);
        expect(validateForm({ ...good, pincode: '021001' }, { emailRequired: false })).toEqual([['pincode', 'pincode']]);
        expect(validateForm({ ...good, email: 'not-an-email' }, { emailRequired: false })).toEqual([['email', 'email']]);
        expect(validateForm({ ...good, gstin: '09ABCDE1234F1Z5' }, { emailRequired: false })).toEqual([]);
        expect(isGstin('09ABCDE1234F1X5')).toBe(false);
    });
});

describe('the attempt key', () => {
    it('is stable across a reload and the resubmit after an OTP', () => {
        const store = memory();
        const make = counter();
        const hash = cartHash({ lines: [line('a')] });
        const first = attemptFor(store, 'inst-1', hash, 1, make);
        const again = attemptFor(store, 'inst-1', hash, 2, make);
        expect(again.id).toBe(first.id);
        expect(first.id.length).toBeGreaterThanOrEqual(8);
        expect(first.id.length).toBeLessThanOrEqual(64);
        expect(store.data.has(attemptKey('inst-1'))).toBe(true);
    });

    it('is new for another cart, and on renew (order_not_payable, a cancelled replay, idempotency_key_reused)', () => {
        const store = memory();
        const make = counter();
        const one = attemptFor(store, 'inst-1', cartHash({ lines: [line('a')] }), 1, make);
        const other = attemptFor(store, 'inst-1', cartHash({ lines: [line('a', 2)] }), 2, make);
        expect(other.id).not.toBe(one.id);
        const renewed = renewAttempt(store, 'inst-1', other.cartHash, 3, make);
        expect(renewed.id).not.toBe(other.id);
        expect(attemptFor(store, 'inst-1', other.cartHash, 4, make).id).toBe(renewed.id);
    });

    it('keeps the order, its token and the release token with the attempt', () => {
        const attempt = withPlaced(
            { id: 'cx-1', cartHash: 'h', createdAt: 0 },
            {
                order_id: 'o1',
                order_number: 'ORD-000123',
                status: 'PENDING_PAYMENT',
                order_access_token: 'v1.t.s',
                hold: { payment_log_id: 'pl1', release_token: 'rt1', expires_at: '2026-11-15T10:15:00Z' },
            }
        );
        expect(attempt).toMatchObject({ orderId: 'o1', orderNumber: 'ORD-000123', orderToken: 'v1.t.s', hold: { paymentLogId: 'pl1', releaseToken: 'rt1' } });
    });

    it('works without storage', () => {
        const thrower: KeyValueStorage = {
            getItem: () => {
                throw new Error('x');
            },
            setItem: () => {
                throw new Error('x');
            },
            removeItem: () => {
                throw new Error('x');
            },
        };
        expect(attemptFor(thrower, 'inst-1', 'h', 1, counter()).id).toBe('cx-id-1-abcdef');
        expect(attemptFor(null, 'inst-1', 'h', 1, counter()).id).toBe('cx-id-1-abcdef');
    });
});

describe('the checkout body', () => {
    const form = { ...EMPTY_FORM, phone: '9876543210', email: ' a@example.com ', name: ' Asha ', pincode: '221001', city: 'Varanasi', stateCode: '09', line1: '12 Ghat Road', gstin: '09abcde1234f1z5', giftNote: 'Happy Diwali' };

    it('sends consent and save-address only for a proved phone', () => {
        const unverified = buildCheckoutBody({ attemptId: 'cx-1', lines: [], form, method: 'PREPAID', expectedTotal: 979, verified: false, saveAddress: true, marketingConsent: true });
        expect(unverified.save_address).toBeUndefined();
        expect(unverified.marketing_consent).toBeUndefined();
        expect(unverified.phone_token).toBeUndefined();
        const verified = buildCheckoutBody({ attemptId: 'cx-1', lines: [], form, method: 'COD', expectedTotal: 979, verified: true, saveAddress: true, marketingConsent: false, phoneToken: 'v1.a.b', challengeToken: 'ts' });
        expect(verified).toMatchObject({ save_address: true, payment_method: 'COD', phone_token: 'v1.a.b', challenge_token: 'ts', buyer_gstin: '09ABCDE1234F1Z5', gift_note: 'Happy Diwali' });
        expect(verified.marketing_consent).toBeUndefined();
        expect(verified.customer).toEqual({ name: 'Asha', phone: '9876543210', email: 'a@example.com' });
        expect(verified.shipping_address).toMatchObject({ state_code: '09', pincode: '221001', landmark: null });
    });
});

describe('refusals of /checkout', () => {
    it('maps every code of the contract table', () => {
        const cases: Array<[CommerceApiError, string]> = [
            [err(400, 'invalid_request'), 'field'],
            [err(400, 'email_required', { otp_allowed: true }), 'email'],
            [err(403, 'phone_verification_required', { reason: 'mode' }), 'otp'],
            [err(403, 'bot_check_failed'), 'bot_retry'],
            [err(409, 'idempotency_key_reused'), 'new_attempt'],
            [err(409, 'order_not_payable'), 'new_attempt'],
            [err(409, 'price_changed'), 'price_changed'],
            [err(409, 'cart_changed'), 'cart_changed'],
            [err(409, 'out_of_stock'), 'cart_changed'],
            [err(409, 'coupon_not_available'), 'drop_coupon'],
            [err(409, 'payment_method_not_available', { reason: 'PINCODE_BLOCKED' }), 'hide_cod'],
            [err(422, 'cart_not_priceable'), 'back_to_cart'],
            [err(429, 'too_many_open_orders', { otp_allows_more: true }), 'otp'],
            [err(429, 'too_many_open_orders', { otp_allows_more: false }), 'too_many'],
            [err(429, 'rate_limited'), 'wait'],
            [err(503, 'checkout_not_configured'), 'later'],
            [err(503, 'buyer_unavailable'), 'later'],
            [err(500, ''), 'later'],
        ];
        for (const [error, action] of cases) expect(checkoutErrorAction(error), error.code).toBe(action);
        expect(checkoutErrorAction(new CommerceApiError('network', 0, '', 'network'))).toBe('network');
    });
    it('hides cash on delivery for every reason the server gives, and asks for an OTP when COD needs one', () => {
        for (const reason of ['ORDER_ABOVE_COD_LIMIT', 'PINCODE_BLOCKED', 'PINCODE_INVALID', 'OPEN_COD_ORDERS', 'COD_REFUSALS', 'COD_DISABLED', 'COD_NOT_AVAILABLE']) {
            expect(checkoutErrorAction(err(409, 'payment_method_not_available', { reason })), reason).toBe('hide_cod');
        }
        expect(checkoutErrorAction(err(403, 'phone_verification_required', { param: 'phone_token', reason: 'cod' }))).toBe('otp');
    });
});

describe('the order page', () => {
    const now = Date.UTC(2026, 10, 15, 10, 0, 0);
    const later = new Date(now + 10 * 60_000).toISOString();

    it('never offers a payment while one is in progress', () => {
        expect(orderStage({ status: 'PENDING_PAYMENT', payment_processing: true, payment_retryable: true, hold_expires_at: later }, now)).toEqual({ kind: 'processing' });
        expect(orderStage({ status: 'CONFIRMED', payment_processing: true }, now).kind).toBe('processing');
    });

    it('offers "Pay now" until the hold ends', () => {
        expect(orderStage({ status: 'PENDING_PAYMENT', payment_processing: false, payment_retryable: true, hold_expires_at: later }, now)).toEqual({ kind: 'pay', until: now + 10 * 60_000 });
        expect(orderStage({ status: 'PENDING_PAYMENT', payment_retryable: true, hold_expires_at: new Date(now - 1).toISOString() }, now).kind).toBe('expired');
        expect(orderStage({ status: 'PENDING_PAYMENT', payment_retryable: false }, now).kind).toBe('expired');
    });

    it('names the other states', () => {
        expect(orderStage({ status: 'COD_PENDING_CONFIRMATION' }, now).kind).toBe('cod_pending');
        expect(orderStage({ status: 'CONFIRMED' }, now).kind).toBe('placed');
        expect(orderStage({ status: 'SHIPPED' }, now).kind).toBe('placed');
        expect(orderStage({ status: 'CANCELLED', cancel_reason: 'PAYMENT_EXPIRED' }, now)).toEqual({ kind: 'cancelled', reason: 'PAYMENT_EXPIRED' });
        expect(orderStage({ status: 'RTO' }, now).kind).toBe('returned');
    });

    it('polls every 3 s for 30 s, then every 10 s up to 5 minutes, then stops', () => {
        expect(pollDelay(0)).toBe(3000);
        expect(pollDelay(29_999)).toBe(3000);
        expect(pollDelay(30_000)).toBe(10_000);
        expect(pollDelay(299_999)).toBe(10_000);
        expect(pollDelay(300_000)).toBeNull();
    });

    it('just paid on this device: an unpaid order reads "confirming" for five minutes, then as before', () => {
        const pending = { status: 'PENDING_PAYMENT', payment_processing: false, payment_retryable: true, hold_expires_at: later };
        expect(orderStage(pending, now, now - 1000).kind).toBe('processing');
        expect(orderStage(pending, now, now - 5 * 60_000).kind).toBe('pay');
        expect(orderStage(pending, now, null).kind).toBe('pay');
        expect(orderStage({ status: 'CONFIRMED' }, now, now).kind).toBe('placed');
    });

    it('reads the order token of an older link from the fragment', () => {
        expect(readOrderFragment('#t=v1.abc.def')).toBe('v1.abc.def');
        expect(readOrderFragment('#x=1&t=v1.a.b')).toBe('v1.a.b');
        expect(readOrderFragment('')).toBeNull();
        expect(readOrderFragment('#t=<script>')).toBeNull();
    });

    it('reads the link token of an order message from the fragment', () => {
        // valid
        expect(readOrderLinkFragment('#l=l1.abc.def')).toBe('l1.abc.def');
        expect(readOrderLinkFragment('l=l1.a_b-c.d-e_f')).toBe('l1.a_b-c.d-e_f');
        expect(readOrderLinkFragment('')).toBeNull();
        expect(readOrderLinkFragment(null)).toBeNull();
        expect(readOrderLinkFragment('#t=v1.abc.def')).toBeNull();
        // too long: 200 characters at most
        expect(readOrderLinkFragment(`#l=${'a'.repeat(200)}`)).toBe('a'.repeat(200));
        expect(readOrderLinkFragment(`#l=${'a'.repeat(201)}`)).toBeNull();
        // bad characters (the "~" of order tokens is not in a link token)
        expect(readOrderLinkFragment('#l=<script>')).toBeNull();
        expect(readOrderLinkFragment('#l=l1.abc~def')).toBeNull();
        expect(readOrderLinkFragment('#l=l1.abc%20def')).toBeNull();
        expect(readOrderLinkFragment('#l=l1.ab+c.def')).toBeNull();
        expect(readOrderLinkFragment('#l=')).toBeNull();
        // both "t" and "l": each reader takes its own
        expect(readOrderLinkFragment('#t=v1.abc.def&l=l1.abc.def')).toBe('l1.abc.def');
        expect(readOrderFragment('#t=v1.abc.def&l=l1.abc.def')).toBe('v1.abc.def');
    });
});
