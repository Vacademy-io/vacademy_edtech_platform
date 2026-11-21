import { describe, expect, it } from 'vitest';
import { ORDER_TOKEN_HEADER, PHONE_TOKEN_HEADER, SESSION_HEADER, createCommerceClient, errorFromBody } from './client';
import type { CheckoutRequestBody } from './types';

const KEY = `vak_pub_${'b2'.repeat(24)}`;
const SESSION = 's1.eyJpIjoiaW5zdC0xIn0.c2lnbmF0dXJl';
const PHONE_TOKEN = 'v1.eyJjIjoxfQ.c2ln';
const ORDER_TOKEN = 'v1.aW5zdHxvcmRlcnwx.c2ln';
const LINK_TOKEN = 'l1.abc.def';
const BASE = 'https://api.example/admin-core-service/open/commerce/v1';

const stub = (status = 200, body: unknown = { ok: true }, headers: Record<string, string> = {}) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init || {} });
        return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
    }) as typeof fetch;
    const client = createCommerceClient({ baseUrl: 'https://api.example', publishableKey: KEY, locale: 'hi', fetchImpl });
    return { client, calls };
};

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;
const TOKENS = [SESSION, PHONE_TOKEN, ORDER_TOKEN];

const body: CheckoutRequestBody = {
    client_request_id: 'cx-12345678',
    lines: [{ line_ref: 'v1', variant_id: 'v1', quantity: 1 }],
    payment_method: 'PREPAID',
    expected_total: 979,
    customer: { name: 'Asha', phone: '9876543210' },
    shipping_address: { name: 'Asha', phone: '9876543210', line1: '12 Ghat Road', city: 'Varanasi', state_code: '09', pincode: '221001' },
    phone_token: PHONE_TOKEN,
};

describe('buying calls', () => {
    it('sends every call to its route with the publishable key, never cached, never with cookies or Authorization', async () => {
        const { client, calls } = stub();
        await client.getCheckoutConfig();
        await client.requestOtp({ phone: '+919876543210', purpose: 'CHECKOUT', challenge_token: 'ts-1' });
        await client.verifyOtp({ phone: '+919876543210', code: '123456', purpose: 'ACCOUNT' });
        await client.placeOrder(body, { session: SESSION });
        await client.confirmPayment('ord 1', { gateway_order_id: 'order_x', gateway_payment_id: 'pay_x', signature: 'sig' });
        await client.retryPayment('ord-1', ORDER_TOKEN);
        await client.viewOrder(ORDER_TOKEN);
        await client.trackOrder({ order_number: 'ORD-000123', phone_token: PHONE_TOKEN });
        await client.getMe({ session: SESSION });
        await client.myOrders({ session: SESSION }, 2, 20);
        await client.myAddresses({ phoneToken: PHONE_TOKEN });
        await client.setConsent({ session: SESSION }, true);
        expect(calls.map((c) => `${c.init.method} ${c.url.replace(BASE, '')}`)).toEqual([
            'GET /checkout/config',
            'POST /otp/request',
            'POST /otp/verify',
            'POST /checkout',
            'POST /checkout/ord%201/confirm-payment',
            'POST /checkout/ord-1/retry-payment',
            'GET /orders/view',
            'POST /orders/track',
            'GET /me',
            'GET /me/orders?page=2&page_size=20',
            'GET /me/addresses',
            'PUT /me/consent',
        ]);
        for (const call of calls) {
            expect(headersOf(call.init)['X-API-Key']).toBe(KEY);
            expect(headersOf(call.init).Authorization).toBeUndefined();
            expect(call.init.credentials).toBe('omit');
        }
        expect(calls.slice(1).every((c) => c.init.cache === 'no-store')).toBe(true);
    });

    it('never puts a token into a URL', async () => {
        const { client, calls } = stub();
        await client.placeOrder(body, { session: SESSION });
        await client.retryPayment('ord-1', ORDER_TOKEN);
        await client.viewOrder(ORDER_TOKEN);
        await client.trackOrder({ order_number: 'ORD-1', phone_token: PHONE_TOKEN });
        await client.getMe({ session: SESSION });
        await client.myOrders({ phoneToken: PHONE_TOKEN }, 0);
        await client.updateAddress({ session: SESSION }, 'a1', body.shipping_address);
        for (const call of calls) {
            for (const token of TOKENS) expect(call.url).not.toContain(token);
            expect(call.url).not.toMatch(/[?&]token=/);
        }
    });

    it('carries each token in its own header', async () => {
        const { client, calls } = stub();
        await client.placeOrder(body, { session: SESSION });
        await client.placeOrder(body);
        await client.viewOrder(ORDER_TOKEN);
        await client.retryPayment('ord-1', ORDER_TOKEN);
        await client.getMe({ session: SESSION });
        await client.getMe({ phoneToken: PHONE_TOKEN });
        expect(headersOf(calls[0]!.init)[SESSION_HEADER]).toBe(SESSION);
        expect(headersOf(calls[1]!.init)[SESSION_HEADER]).toBeUndefined();
        expect(headersOf(calls[2]!.init)[ORDER_TOKEN_HEADER]).toBe(ORDER_TOKEN);
        expect(headersOf(calls[3]!.init)[ORDER_TOKEN_HEADER]).toBe(ORDER_TOKEN);
        expect(JSON.parse(calls[3]!.init.body as string)).toEqual({});
        expect(headersOf(calls[4]!.init)[SESSION_HEADER]).toBe(SESSION);
        expect(headersOf(calls[4]!.init)[PHONE_TOKEN_HEADER]).toBeUndefined();
        expect(headersOf(calls[5]!.init)[PHONE_TOKEN_HEADER]).toBe(PHONE_TOKEN);
        expect(headersOf(calls[5]!.init)[SESSION_HEADER]).toBeUndefined();
        // The checkout body carries the phone token (as the contract has it) and the locale.
        const sent = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
        expect(sent.phone_token).toBe(PHONE_TOKEN);
        expect(sent.locale).toBe('hi');
    });

    it('exchanges an order link: POST /orders/link with the key, the link token in the body only', async () => {
        const answer = { order_access_token: ORDER_TOKEN, order_access_token_expires_at: '2026-11-18T10:00:00Z', phone_verified: true };
        const { client, calls } = stub(200, answer);
        await expect(client.exchangeOrderLink(LINK_TOKEN)).resolves.toEqual(answer);
        expect(calls).toHaveLength(1);
        const call = calls[0]!;
        expect(call.url).toBe(`${BASE}/orders/link`);
        expect(call.url).not.toContain(LINK_TOKEN);
        expect(call.init.method).toBe('POST');
        expect(call.init.cache).toBe('no-store');
        expect(call.init.credentials).toBe('omit');
        expect(headersOf(call.init)['X-API-Key']).toBe(KEY);
        expect(headersOf(call.init)['content-type']).toBe('application/json');
        expect(headersOf(call.init).Authorization).toBeUndefined();
        expect(Object.values(headersOf(call.init)).join(' ')).not.toContain(LINK_TOKEN);
        expect(JSON.parse(call.init.body as string)).toEqual({ link_token: LINK_TOKEN });
    });

    it('releases a hold on the stock-hold route, without the shop key', async () => {
        const { client, calls } = stub(200, { released: 1 });
        await expect(client.releaseHold({ payment_log_id: 'plog-1', release_token: 'rt-1' })).resolves.toEqual({ released: 1 });
        expect(calls[0]!.url).toBe('https://api.example/admin-core-service/open/v1/stock-hold/release');
        expect(headersOf(calls[0]!.init)['X-API-Key']).toBeUndefined();
        expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ payment_log_id: 'plog-1', release_token: 'rt-1' });
    });

    it('takes a 204 for logout and delete', async () => {
        const { client, calls } = stub(204);
        await expect(client.logout({ session: SESSION })).resolves.toBeUndefined();
        await expect(client.deleteAddress({ session: SESSION }, 'a 1')).resolves.toBeUndefined();
        expect(calls[0]!.url).toBe(`${BASE}/me/logout`);
        expect(calls[1]!.url).toBe(`${BASE}/me/addresses/a%201`);
        expect(calls[1]!.init.method).toBe('DELETE');
    });
});

describe('buying errors', () => {
    it('keeps the code and details of the new refusals', async () => {
        const { client } = stub(403, { error: { code: 'phone_verification_required', message: 'x', details: { param: 'phone_token', reason: 'cod' } } });
        await expect(client.placeOrder(body)).rejects.toMatchObject({
            status: 403,
            code: 'phone_verification_required',
            details: { param: 'phone_token', reason: 'cod' },
        });
        expect(errorFromBody(400, { error: { code: 'email_required', details: { otp_allowed: true } } }).details).toEqual({ otp_allowed: true });
        expect(errorFromBody(409, { error: { code: 'payment_method_not_available', details: { reason: 'PINCODE_BLOCKED' } } })).toMatchObject({
            kind: 'conflict',
            details: { reason: 'PINCODE_BLOCKED' },
        });
        expect(errorFromBody(401, { error: { code: 'session_invalid' } })).toMatchObject({ kind: 'unauthorized', details: null });
        expect(errorFromBody(400, { error: { code: 'x', details: ['not', 'an', 'object'] } }).details).toBeNull();
    });

    it('maps the order link refusals', async () => {
        await expect(stub(410, { error: { code: 'link_expired' } }).client.exchangeOrderLink(LINK_TOKEN)).rejects.toMatchObject({ status: 410, code: 'link_expired', kind: 'invalid' });
        await expect(stub(403, { error: { code: 'link_invalid' } }).client.exchangeOrderLink(LINK_TOKEN)).rejects.toMatchObject({ status: 403, code: 'link_invalid', kind: 'unauthorized' });
        await expect(stub(400, { error: { code: 'invalid_request' } }).client.exchangeOrderLink(LINK_TOKEN)).rejects.toMatchObject({ status: 400, kind: 'invalid' });
        await expect(stub(429, { error: { code: 'rate_limited' } }, { 'retry-after': '30' }).client.exchangeOrderLink(LINK_TOKEN)).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 30, retryable: true });
        await expect(stub(503, { error: { code: 'checkout_not_configured' } }).client.exchangeOrderLink(LINK_TOKEN)).rejects.toMatchObject({ status: 503, kind: 'server', retryable: true });
    });

    it('reads Retry-After of an OTP rate limit', async () => {
        const { client } = stub(429, { error: { code: 'rate_limited' } }, { 'retry-after': '45' });
        await expect(client.requestOtp({ phone: '+919876543210', purpose: 'TRACK_ORDER' })).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 45 });
    });
});
