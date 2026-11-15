// @vitest-environment jsdom
/**
 * The buying pages rendered in jsdom against a stubbed public API (contract P2 §11, item 7):
 * checkout per buyer-identity mode in Hindi, the WhatsApp code step, COD only when the shop
 * sells it online and the cart qualifies, the order page states, track order and the account.
 * Razorpay is a stub on window; layout and real network behaviour are not covered here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/shop/checkout', search: '', hash: '', searchStr: '' },
    replace: [] as string[],
    navigate: [] as string[],
    states: [] as unknown[],
}));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({
        history: { location: router.location, replace: (href: string) => void router.replace.push(href) },
        navigate: ({ href, state }: { href: string; state?: unknown }) => {
            router.navigate.push(href);
            router.states.push(state);
            return Promise.resolve();
        },
        latestLocation: { search: {} },
    }),
    useNavigate: () => () => Promise.resolve(),
    useLocation: (opts?: { select?: (location: unknown) => unknown }) => (opts?.select ? opts.select(router.location) : router.location),
    useParams: () => ({}),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hi } from '../i18n/messages.hi';
import { useCommerceCart } from '../state/cart-store';
import { ORDER_KEY_STATE, handOffOrder, orderHandoffKey, readOrderHandoff, resetOrderHandoffMemory } from '../state/order-handoff';
import { AccountPage } from './Account';
import { CheckoutPage } from './Checkout';
import { OrderPage } from './OrderPage';
import { TrackOrderPage } from './TrackOrder';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'c3'.repeat(24)}`;
const SETTINGS = {
    commerce: {
        enabled: true,
        checkout: true,
        publishableKey: KEY,
        whatsappNumber: '+919800000000',
        dispatchPromise: 'Ships in 2 working days',
        reassurance: [{ label: 'Handwoven in Varanasi', text: '' }],
    },
};
const SESSION = 's1.eyJpIjoiaW5zdC0xIn0.c2lnbmF0dXJl';
const ORDER_TOKEN = 'v1.b3JkZXI.c2ln';

type Json = Record<string, unknown>;
let config: Json;
let price: Json;
let checkoutAnswers: Array<{ status: number; body: Json }>;
let orderView: Json;
let trackAnswer: { status: number; body: Json };
let myOrders: Json;
const requests: Array<{ url: string; path: string; method: string; headers: Record<string, string>; body: Json | null }> = [];

const baseConfig = (): Json => ({
    buyer_identity: 'EITHER',
    otp: { channel: 'WHATSAPP', code_length: 6, resend_after: 60 },
    bot_check: { required: false, site_key: null },
    payment_methods: ['PREPAID'],
    cod: { enabled: false, online: false, max_order_value: 5000, staff_confirm_threshold: 3000 },
    hold_minutes: 15,
    session_days: 7,
    currency: 'INR',
});

const basePrice = (): Json => ({
    currency: 'INR',
    payment_method: 'PREPAID',
    lines: [{ line_ref: 'v1', variant_id: 'v1', sku: 'SAR-1', slug: 'red-saree', name: 'लाल साड़ी', variant_label: null, quantity: 1, qty_scale: 1, qty_step: 1, piece: false, unit: 'PCS', unit_price: 4899, compare_at_price: null, gross: 4899, discount: 0, net: 4899 }],
    unavailable: [],
    changes: [],
    discounts: [],
    coupon: null,
    shipping: { basis: 'FLAT', charge: 80, charge_before_free: 80, free: false, free_above: null, remaining_for_free: null },
    cod: { eligible: false, reason: 'COD_DISABLED', charge: null, max_order_value: null, total_with_cod: null, needs_staff_confirmation: false, otp_required: true, pincode_checked: false },
    tax: { head: 'CGST_SGST', tax_amount: 233.29, place_of_supply_known: true },
    totals: { subtotal: 4899, discount: 0, shipping: 80, cod_charge: 0, round_off: 0, total: 4979, line_count: 1 },
});

const placed = (extra: Json = {}): Json => ({
    order_id: 'ord-1',
    order_number: 'ORD-000123',
    status: 'PENDING_PAYMENT',
    payment_status: 'PENDING',
    currency: 'INR',
    total: 4979,
    payment: { vendor: 'RAZORPAY', gateway_order_id: 'order_1', key_id: 'rzp_test_1', amount_minor: 497900, currency: 'INR' },
    payment_retryable: false,
    payment_processing: false,
    hold: { payment_log_id: 'plog-1', release_token: 'rt-1', expires_at: '2030-01-01T00:00:00Z' },
    order_access_token: ORDER_TOKEN,
    replayed: false,
    ...extra,
});

const view = (extra: Json = {}): Json => ({
    order_id: 'ord-1',
    order_number: 'ORD-000123',
    status: 'CONFIRMED',
    payment_status: 'PAID',
    payment_method: 'PREPAID',
    placed_at: '2026-11-15T10:00:00Z',
    payment_retryable: false,
    payment_processing: false,
    currency: 'INR',
    lines: [{ line_ref: 'v1', name: 'लाल साड़ी', sku: 'SAR-1', quantity: 1, qty_scale: 1, unit: 'PCS', unit_price: 4899, line_total: 4899 }],
    totals: { subtotal: 4899, shipping: 80, tax: 233.29, total: 4979 },
    recipient: { name: 'Asha', phone_masked: '••••••3210', city: 'Varanasi', state_code: '09', pincode: '221001' },
    timeline: [{ status: 'CONFIRMED', at: '2026-11-15T10:01:00Z' }],
    ...extra,
});

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname.replace('/admin-core-service/open/commerce/v1', '');
        requests.push({
            url: url.toString(),
            path,
            method: init?.method || 'GET',
            headers: (init?.headers || {}) as Record<string, string>,
            body: init?.body ? (JSON.parse(init.body as string) as Json) : null,
        });
        const json = (body: unknown, status = 200) =>
            new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (path === '/checkout/config') return json(config);
        if (path === '/cart/price') {
            const sent = JSON.parse(init!.body as string) as Json;
            return json({ ...price, payment_method: sent.payment_method });
        }
        if (path.startsWith('/pincode/')) return json({ pincode: '221001', city: 'Varanasi', state_code: '09', state_name: 'Uttar Pradesh', state_source: 'DIRECTORY', cod_allowed: true, cod_reason: null, dispatch_promise: null });
        if (path === '/otp/request') return json({ sent: true, expires_in: 540, resend_after: 60 });
        if (path === '/otp/verify') {
            return json({ verified_phone_token: 'v1.cGhvbmU.c2ln', expires_in: 900, shopper_session_token: SESSION, shopper_session_expires_in: 604800, phone_masked: '••••••3210' });
        }
        if (path === '/checkout') {
            const next = checkoutAnswers.shift() || { status: 200, body: placed() };
            return json(next.status === 200 ? next.body : { error: next.body }, next.status);
        }
        if (path.endsWith('/confirm-payment')) return json(placed({ payment: null, payment_processing: true }));
        if (path.endsWith('/retry-payment')) return json(placed());
        if (path === '/orders/view') return json(orderView);
        if (path === '/orders/track') return json(trackAnswer.status === 200 ? trackAnswer.body : { error: trackAnswer.body }, trackAnswer.status);
        if (path === '/me') return json({ name: 'Asha', phone: '919876543210', phone_masked: '••••••3210', email_masked: null, marketing_consent: false, session_expires_at: '2030-01-01T00:00:00Z' });
        if (path === '/me/orders') return json(myOrders);
        if (path === '/me/addresses') return json([]);
        if (path === '/me/logout') return json(null, 204);
        if (url.pathname.endsWith('/stock-hold/release')) return json({ released: 1 });
        return json({ error: { code: 'not_found' } }, 404);
    });

let root: Root | null = null;
let container: HTMLDivElement;

const render = async (node: React.ReactNode) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    container.setAttribute('data-catalogue-theme', 'default');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={SETTINGS} siteName="Example Brand">
                    {node}
                </CommerceSiteProvider>
            </QueryClientProvider>
        );
    });
};

const settle = async (until: () => boolean, tries = 150) => {
    for (let i = 0; i < tries && !until(); i += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    }
    expect(until()).toBe(true);
};

const text = () => document.body.textContent || '';
const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy();
    await act(async () => {
        (element as HTMLElement).click();
    });
};
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes(label)) || null;
const field = (label: string): HTMLInputElement | HTMLSelectElement => {
    const found = Array.from(document.querySelectorAll('label')).find((l) => (l.textContent || '').trim().startsWith(label));
    expect(found, label).toBeTruthy();
    return document.getElementById(found!.htmlFor) as HTMLInputElement | HTMLSelectElement;
};
const type = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    await act(async () => {
        const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
        element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
};
const calls = (path: string) => requests.filter((r) => r.path === path);
const payButton = () => document.querySelector('.cmx-paybar button[type="submit"]') as HTMLButtonElement | null;

const fillAddress = async (opts: { email?: string } = {}) => {
    await type(field(hi['form.phone']), '9876543210');
    if (opts.email) await type(field(hi['form.email']), opts.email);
    await type(field(hi['form.pincode']), '221001');
    await settle(() => (field(hi['form.city']) as HTMLInputElement).value === 'Varanasi');
    expect((field(hi['form.state']) as HTMLSelectElement).value).toBe('09');
    await type(field(hi['form.name']), 'Asha');
    await type(field(hi['form.line1']), '12 Ghat Road');
    // The new PIN and state are priced again before the button comes back.
    await settle(() => !!payButton() && !payButton()!.disabled);
};

class RazorpayStub {
    static opened: Array<Record<string, unknown>> = [];
    constructor(private readonly options: Record<string, unknown>) {
        RazorpayStub.opened.push(options);
    }
    on() {}
    open() {
        const handler = this.options.handler as (r: Record<string, string>) => void;
        setTimeout(() => handler({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig_1' }), 0);
    }
}

/** A plain Storage: this runtime's jsdom window comes without one. */
const memoryStorage = (): Storage => {
    const data = new Map<string, string>();
    return {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        getItem: (k: string) => data.get(k) ?? null,
        key: (i: number) => Array.from(data.keys())[i] ?? null,
        removeItem: (k: string) => void data.delete(k),
        setItem: (k: string, v: string) => void data.set(k, String(v)),
    };
};

/** The order record this tab keeps for the history state the order page was opened with. */
const handoffOf = (state: unknown) => readOrderHandoff('inst-1', state, window.sessionStorage);

/** The history state carries only the random key: never the token, the paid time or anything else. */
const expectKeyOnly = (state: unknown) => {
    expect(Object.keys(state as Record<string, unknown>)).toEqual([ORDER_KEY_STATE]);
    expect(JSON.stringify(state)).not.toContain(ORDER_TOKEN);
};

beforeEach(() => {
    resetOrderHandoffMemory();
    Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), configurable: true });
    requests.length = 0;
    router.navigate.length = 0;
    router.states.length = 0;
    router.replace.length = 0;
    config = baseConfig();
    price = basePrice();
    checkoutAnswers = [];
    orderView = view();
    trackAnswer = { status: 404, body: { code: 'not_found', message: 'x' } };
    myOrders = { orders: [], page: 0, page_size: 20, total: 0 };
    window.localStorage.clear();
    window.sessionStorage.clear();
    RazorpayStub.opened = [];
    (window as unknown as { Razorpay?: unknown }).Razorpay = RazorpayStub;
    // The cart the shopper built before checkout, already bound to this site.
    useCommerceCart.setState({
        key: 'commerce-cart:inst-1:shop',
        hydrated: true,
        drawerOpen: false,
        lastAdded: null,
        cart: { version: 1, pincode: null, lines: [{ variantId: 'v1', slug: 'red-saree', name: 'लाल साड़ी', variantLabel: null, imageUrl: null, quantity: 1, qtyScale: 1, qtyStep: 1, unit: 'PCS', piece: false, unitPrice: 4899, addedAt: 1 }] },
    });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    stubApi();
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    delete (window as unknown as { Razorpay?: unknown }).Razorpay;
    delete (window as unknown as { gtag?: unknown }).gtag;
});

describe('checkout', () => {
    it('loads with skeletons (never ₹0), then shows the delivery line and the server total in Hindi', async () => {
        await render(<CheckoutPage />);
        expect(text()).not.toContain('₹0');
        await settle(() => !!payButton() && (payButton()!.textContent || '').includes('₹4,979'));
        expect(container.querySelector('h1')?.textContent).toBe(hi['checkout.title']);
        expect(text()).toContain('डिलीवरी ₹80');
        expect(text()).toContain('Ships in 2 working days');
        expect(payButton()!.textContent).toContain('₹4,979 सुरक्षित भुगतान करें');
        // The PIN field opens the number pad; the phone field the phone pad, after +91.
        expect(field(hi['form.pincode']).getAttribute('inputmode')).toBe('numeric');
        expect(field(hi['form.phone']).getAttribute('inputmode')).toBe('tel');
        expect(text()).toContain('+91');
        // The state is never preselected.
        expect((field(hi['form.state']) as HTMLSelectElement).value).toBe('');
    });

    it('EITHER: recommends WhatsApp and needs an e-mail without it; places a prepaid order and pays by Razorpay', async () => {
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        expect(button(hi['otp.verifyRecommended'])).toBeTruthy();
        await fillAddress();
        await click(payButton());
        // No e-mail and no verified phone: the form says so and sends nothing.
        expect(calls('/checkout')).toHaveLength(0);
        expect(text()).toContain(hi['form.error.required']);
        await type(field(hi['form.email']), 'asha@example.com');
        await click(payButton());
        await settle(() => router.navigate.length === 1);
        const sent = calls('/checkout')[0]!;
        expect(sent.body).toMatchObject({ payment_method: 'PREPAID', expected_total: 4979, customer: { phone: '9876543210', email: 'asha@example.com' } });
        expect(sent.body!.phone_token).toBeUndefined();
        expect(sent.body!.save_address).toBeUndefined();
        expect(RazorpayStub.opened[0]).toMatchObject({ key: 'rzp_test_1', order_id: 'order_1', amount: 497900, name: 'Example Brand' });
        expect(calls('/checkout/ord-1/confirm-payment')[0]!.body).toEqual({ gateway_order_id: 'order_1', gateway_payment_id: 'pay_1', signature: 'sig_1' });
        // The token stays in this tab's sessionStorage: the address and the history state (which
        // analytics scripts and tag managers read) carry only a random key.
        expect(router.navigate[0]).toBe('/shop/order');
        expect(router.navigate[0]).not.toContain(ORDER_TOKEN);
        expectKeyOnly(router.states[0]);
        expect(handoffOf(router.states[0])).toMatchObject({ token: ORDER_TOKEN, paidAt: expect.any(Number), placedHere: true, phoneProved: false });
        expect(window.sessionStorage.getItem(orderHandoffKey('inst-1'))).toContain(ORDER_TOKEN);
        expect(useCommerceCart.getState().cart.lines).toHaveLength(0);
    });

    it('after the payment window says paid, still opens the order as paid when confirm-payment fails', async () => {
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        vi.stubGlobal('fetch', ((original) => async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).includes('/confirm-payment')) throw new TypeError('Failed to fetch');
            return original(input, init);
        })(globalThis.fetch));
        await fillAddress({ email: 'asha@example.com' });
        await click(payButton());
        await settle(() => router.navigate.length === 1);
        expectKeyOnly(router.states[0]);
        expect(handoffOf(router.states[0])).toMatchObject({ token: ORDER_TOKEN, paidAt: expect.any(Number) });
    });

    it('PHONE_OTP: asks for the code before paying, then resubmits with the token and keeps the session apart from learner keys', async () => {
        config = { ...baseConfig(), buyer_identity: 'PHONE_OTP' };
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        expect(text()).toContain(`${hi['form.email']} (${hi['form.optional']})`);
        await fillAddress();
        await click(payButton());
        expect(calls('/checkout')).toHaveLength(0);
        expect(text()).toContain(hi['checkout.needOtp']);
        await click(button(hi['otp.verifyRecommended']));
        await settle(() => calls('/otp/request').length === 1);
        expect(calls('/otp/request')[0]!.body).toEqual({ phone: '+919876543210', purpose: 'CHECKOUT' });
        await settle(() => !!document.querySelector('input[autocomplete="one-time-code"]'));
        expect(text()).toContain('में फिर भेजें');
        await type(document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement, '123456');
        await settle(() => router.navigate.length === 1);
        expect(calls('/otp/verify')[0]!.body).toEqual({ phone: '+919876543210', code: '123456', purpose: 'CHECKOUT' });
        expect(calls('/checkout')[0]!.body!.phone_token).toBe('v1.cGhvbmU.c2ln');
        expect(handoffOf(router.states[0])).toMatchObject({ token: ORDER_TOKEN, placedHere: true, phoneProved: true });
        const stored = JSON.parse(window.localStorage.getItem('cmx.session.v1.inst-1') || '{}') as { token?: string };
        expect(stored.token).toBe(SESSION);
        expect(window.localStorage.getItem('accessToken')).toBeNull();
        expect(window.localStorage.getItem('refreshToken')).toBeNull();
        for (const request of requests) expect(request.headers.Authorization).toBeUndefined();
    });

    it('a stored session for the number counts for a prepaid order: masked phone, session header, no code', async () => {
        config = { ...baseConfig(), buyer_identity: 'PHONE_OTP' };
        window.localStorage.setItem('cmx.session.v1.inst-1', JSON.stringify({ token: SESSION, expiresAt: Date.now() + 3_600_000, phoneMasked: '••••••3210' }));
        await render(<CheckoutPage />);
        // The number comes from /me (memory only), never from storage.
        await settle(() => text().includes('••••••3210') && !!payButton() && !payButton()!.disabled);
        // The name the shop knows is filled in; the phone is shown masked with "Change".
        await settle(() => (field(hi['form.name']) as HTMLInputElement).value === 'Asha');
        expect(button(hi['checkout.change'])).toBeTruthy();
        expect(button(hi['otp.verifyRecommended'])).toBeNull();
        await type(field(hi['form.pincode']), '221001');
        await settle(() => (field(hi['form.city']) as HTMLInputElement).value === 'Varanasi');
        await type(field(hi['form.line1']), '12 Ghat Road');
        await settle(() => !!payButton() && !payButton()!.disabled);
        await click(payButton());
        await settle(() => router.navigate.length === 1);
        const sent = calls('/checkout')[0]!;
        expect(sent.headers['X-Commerce-Session']).toBe(SESSION);
        expect(sent.headers.Authorization).toBeUndefined();
        expect(sent.body!.phone_token).toBeUndefined();
        expect(sent.body!.customer).toMatchObject({ phone: '9876543210', name: 'Asha' });
        expect(calls('/me/addresses')[0]!.headers['X-Commerce-Session']).toBe(SESSION);
        expect(window.localStorage.getItem('cmx.session.v1.inst-1')).not.toContain('9876543210');
    });

    it('a session the server refuses at checkout stops counting: the code step shows', async () => {
        config = { ...baseConfig(), buyer_identity: 'PHONE_OTP' };
        checkoutAnswers = [{ status: 403, body: { code: 'phone_verification_required', message: 'x', details: { param: 'phone_token', reason: 'mode' } } }];
        window.localStorage.setItem('cmx.session.v1.inst-1', JSON.stringify({ token: SESSION, expiresAt: Date.now() + 3_600_000, phoneMasked: '••••••3210' }));
        await render(<CheckoutPage />);
        await settle(() => text().includes('••••••3210') && !!payButton() && !payButton()!.disabled);
        expect(button(hi['otp.verifyRecommended'])).toBeNull();
        await type(field(hi['form.pincode']), '221001');
        await settle(() => (field(hi['form.city']) as HTMLInputElement).value === 'Varanasi');
        await type(field(hi['form.line1']), '12 Ghat Road');
        await settle(() => !!payButton() && !payButton()!.disabled);
        await click(payButton());
        await settle(() => calls('/checkout').length === 1 && text().includes(hi['checkout.needOtp']));
        expect(calls('/checkout')[0]!.headers['X-Commerce-Session']).toBe(SESSION);
        // The code step is there now, so the shopper can go on.
        await settle(() => !!button(hi['otp.verifyRecommended']) || !!document.querySelector('input[autocomplete="one-time-code"]'));
    });

    it('resubmits with the same attempt key after the server asks for the code', async () => {
        checkoutAnswers = [{ status: 403, body: { code: 'phone_verification_required', message: 'x', details: { param: 'phone_token', reason: 'mode' } } }];
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        await fillAddress({ email: 'asha@example.com' });
        await click(payButton());
        await settle(() => text().includes(hi['checkout.needOtp']));
        await click(button(hi['otp.verifyRecommended']));
        await settle(() => !!document.querySelector('input[autocomplete="one-time-code"]'));
        await type(document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement, '123456');
        await settle(() => calls('/checkout').length === 2);
        const [first, second] = calls('/checkout');
        expect(second!.body!.client_request_id).toBe(first!.body!.client_request_id);
        expect(second!.body!.phone_token).toBe('v1.cGhvbmU.c2ln');
    });

    it('EMAIL: e-mail required, the code offered only for saved addresses', async () => {
        config = { ...baseConfig(), buyer_identity: 'EMAIL' };
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        expect(button(hi['otp.verifyRecommended'])).toBeNull();
        expect(button(hi['checkout.useSaved'])).toBeTruthy();
        expect(text()).not.toContain(`${hi['form.email']} (${hi['form.optional']})`);
        // The e-mail stays required after a code in this mode, so no "or verify on WhatsApp" hint.
        expect(text()).toContain(hi['checkout.emailHint']);
        expect(text()).not.toContain(hi['checkout.emailHintRequired']);
    });

    it('EITHER: the e-mail hint offers WhatsApp instead', async () => {
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        expect(text()).toContain(hi['checkout.emailHintRequired']);
    });

    it('shows COD only when the shop sells it online and the cart qualifies; COD always asks for the code', async () => {
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        expect(text()).not.toContain(hi['checkout.pay.cod']);
        await act(async () => root?.unmount());
        document.body.innerHTML = '';

        config = { ...baseConfig(), payment_methods: ['PREPAID', 'COD'], cod: { enabled: true, online: false } };
        price = { ...basePrice(), cod: { ...(basePrice().cod as Json), eligible: true, reason: null } };
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        expect(text()).not.toContain(hi['checkout.pay.cod']);
        await act(async () => root?.unmount());
        document.body.innerHTML = '';

        config = { ...baseConfig(), payment_methods: ['PREPAID', 'COD'], cod: { enabled: true, online: true } };
        await render(<CheckoutPage />);
        await settle(() => text().includes(hi['checkout.pay.cod']));
        expect(text()).toContain(hi['checkout.pay.codOtp']);
        const cod = Array.from(document.querySelectorAll('input[name="cmx-pay"]')).find((i) => (i as HTMLInputElement).value === 'cod') as HTMLInputElement;
        await click(cod);
        await settle(() => calls('/cart/price').some((r) => r.body!.payment_method === 'COD'));
        await fillAddress({ email: 'asha@example.com' });
        await settle(() => !!payButton() && !payButton()!.disabled);
        expect(payButton()!.textContent).toContain('ऑर्डर करें');
        await click(payButton());
        expect(calls('/checkout')).toHaveLength(0);
        expect(text()).toContain(hi['checkout.codNeedsOtp']);

        // Not eligible: a one-line reason instead of the option.
        await act(async () => root?.unmount());
        document.body.innerHTML = '';
        price = { ...basePrice(), cod: { ...(basePrice().cod as Json), eligible: false, reason: 'PINCODE_BLOCKED' } };
        await render(<CheckoutPage />);
        await settle(() => text().includes(hi['checkout.cod.PINCODE_BLOCKED']));
        expect(text()).not.toContain(hi['checkout.pay.codOtp']);
    });

    it('places a verified COD order without Razorpay and sends purchase once', async () => {
        config = { ...baseConfig(), buyer_identity: 'PHONE_OTP', payment_methods: ['PREPAID', 'COD'], cod: { enabled: true, online: true } };
        price = { ...basePrice(), cod: { ...(basePrice().cod as Json), eligible: true, reason: null } };
        checkoutAnswers = [{ status: 200, body: placed({ status: 'COD_PENDING_CONFIRMATION', payment: null, hold: null }) }];
        const gtag = vi.fn();
        (window as unknown as { gtag: unknown }).gtag = gtag;
        await render(<CheckoutPage />);
        await settle(() => text().includes(hi['checkout.pay.cod']));
        const cod = Array.from(document.querySelectorAll('input[name="cmx-pay"]')).find((i) => (i as HTMLInputElement).value === 'cod') as HTMLInputElement;
        await click(cod);
        await fillAddress();
        await settle(() => !!payButton() && !payButton()!.disabled);
        await click(payButton());
        await click(button(hi['otp.verifyRecommended']));
        await settle(() => !!document.querySelector('input[autocomplete="one-time-code"]'));
        await type(document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement, '123456');
        await settle(() => router.navigate.length === 1);
        expect(calls('/checkout')[0]!.body).toMatchObject({ payment_method: 'COD', phone_token: 'v1.cGhvbmU.c2ln' });
        // A COD order never sends the session as its proof.
        expect(calls('/checkout')[0]!.headers['X-Commerce-Session']).toBeUndefined();
        expect(RazorpayStub.opened).toHaveLength(0);
        const purchases = gtag.mock.calls.filter((c) => c[1] === 'purchase');
        expect(purchases).toHaveLength(1);
        expect(purchases[0]![2]).toMatchObject({ transaction_id: 'ORD-000123', payment_type: 'cod' });
        expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/9876543210|Asha|Ghat|v1\.|s1\./);
    });

    it('offers "Pay now" and "Cancel order" after the payment window is closed', async () => {
        (window as unknown as { Razorpay: unknown }).Razorpay = class {
            constructor(private readonly o: Record<string, unknown>) {}
            on() {}
            open() {
                setTimeout(() => (this.o.modal as { ondismiss: () => void }).ondismiss(), 0);
            }
        };
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && !payButton()!.disabled);
        await fillAddress({ email: 'asha@example.com' });
        await click(payButton());
        await settle(() => !!button(hi['checkout.cancelOrder']));
        expect(text()).toContain('ORD-000123');
        await click(button(hi['checkout.cancelOrder']));
        await settle(() => requests.some((r) => r.url.endsWith('/open/v1/stock-hold/release')));
        expect(requests.find((r) => r.url.endsWith('/stock-hold/release'))!.body).toEqual({ payment_log_id: 'plog-1', release_token: 'rt-1' });
        await settle(() => text().includes(hi['checkout.cancelled']));
        // The next attempt gets a new key.
        await click(payButton());
        await settle(() => calls('/checkout').length === 2);
        expect(calls('/checkout')[1]!.body!.client_request_id).not.toBe(calls('/checkout')[0]!.body!.client_request_id);
    });

    it('keeps submit off while offline', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        await render(<CheckoutPage />);
        await settle(() => !!payButton() && text().includes(hi['cart.offline']));
        expect(payButton()!.disabled).toBe(true);
    });

    it('says checkout is unavailable when the bot check is on without a site key', async () => {
        config = { ...baseConfig(), bot_check: { required: true, site_key: null } };
        await render(<CheckoutPage />);
        await settle(() => text().includes(hi['checkout.unavailable']));
        expect(payButton()).toBeNull();
    });
});

describe('order page', () => {
    /** Opens the order page as the storefront does: a key in the history state, the token in sessionStorage. */
    const open = async (opts: { paidAt?: number; placedHere?: boolean; phoneProved?: boolean } = { placedHere: true }) => {
        const state = handOffOrder('inst-1', ORDER_TOKEN, opts, window.sessionStorage);
        window.history.replaceState(state, '', '/shop/order');
        await render(<OrderPage />);
        return state;
    };
    const remount = async () => {
        await act(async () => root?.unmount());
        document.body.innerHTML = '';
        await render(<OrderPage />);
    };

    it('reads the token this tab kept for the history key and sends it only as a header', async () => {
        await open();
        await settle(() => calls('/orders/view').length === 1);
        expect(window.location.href).not.toContain(ORDER_TOKEN);
        expect(JSON.stringify(window.history.state)).not.toContain(ORDER_TOKEN);
        const request = calls('/orders/view')[0]!;
        expect(request.headers['X-Commerce-Order-Token']).toBe(ORDER_TOKEN);
        expect(request.url).not.toContain(ORDER_TOKEN);
    });

    it('an older "#t=" link still opens, and the token leaves the address at once', async () => {
        window.history.replaceState(null, '', `/shop/order#t=${ORDER_TOKEN}`);
        await render(<OrderPage />);
        await settle(() => calls('/orders/view').length === 1);
        expect(window.location.hash).toBe('');
        expectKeyOnly(window.history.state);
        expect(handoffOf(window.history.state)?.token).toBe(ORDER_TOKEN);
        expect(calls('/orders/view')[0]!.headers['X-Commerce-Order-Token']).toBe(ORDER_TOKEN);
        // Read once: a reload of the stripped address opens the same order.
        await remount();
        await settle(() => calls('/orders/view').length === 2);
        expect(calls('/orders/view')[1]!.headers['X-Commerce-Order-Token']).toBe(ORDER_TOKEN);
    });

    it('a language switch that replaces the history state keeps the order across a reload', async () => {
        await open();
        await settle(() => text().includes(hi['order.thanks']));
        // What router.history.replace(path) leaves: the router's own keys only.
        window.history.replaceState({ key: 'k1', __TSR_key: 'k1', __TSR_index: 4 }, '', '/shop/order?lang=en');
        await remount();
        await settle(() => calls('/orders/view').length === 2);
        expect(calls('/orders/view')[1]!.headers['X-Commerce-Order-Token']).toBe(ORDER_TOKEN);
        await settle(() => text().includes(hi['order.thanks']));
        // The key is back in the entry, next to the router's own.
        expect(window.history.state).toMatchObject({ __TSR_index: 4, [ORDER_KEY_STATE]: expect.any(String) });
    });

    it('just paid on this device: an order still unpaid on the server reads "confirming", with no pay button', async () => {
        orderView = view({ status: 'PENDING_PAYMENT', payment_status: 'PENDING', payment_processing: false, payment_retryable: true, hold_expires_at: '2030-01-01T00:00:00Z' });
        await open({ paidAt: Date.now(), placedHere: true });
        await settle(() => text().includes(hi['order.processing.title']));
        expect(button(hi['checkout.payNow'])).toBeNull();
    });

    it('confirmed after checkout in this tab: thanks, timeline, and purchase once per order number', async () => {
        const gtag = vi.fn();
        (window as unknown as { gtag: unknown }).gtag = gtag;
        await open({ placedHere: true });
        await settle(() => text().includes(hi['order.thanks']));
        expect(text()).toContain(hi['order.step.CONFIRMED']);
        expect(text()).toContain('₹4,979');
        expect(gtag.mock.calls.filter((c) => c[1] === 'purchase')).toHaveLength(1);
        await act(async () => root?.unmount());
        document.body.innerHTML = '';
        await open({ placedHere: true });
        await settle(() => text().includes(hi['order.thanks']));
        expect(gtag.mock.calls.filter((c) => c[1] === 'purchase')).toHaveLength(1);
    });

    it('an old order opened from the account (or an old link) never sends purchase', async () => {
        const gtag = vi.fn();
        (window as unknown as { gtag: unknown }).gtag = gtag;
        orderView = view({ status: 'DELIVERED' });
        await open({ phoneProved: true });
        await settle(() => text().includes(hi['order.status.DELIVERED']));
        expect(gtag.mock.calls.filter((c) => c[1] === 'purchase')).toHaveLength(0);
        await act(async () => root?.unmount());
        document.body.innerHTML = '';
        window.history.replaceState(null, '', `/shop/order#t=${ORDER_TOKEN.replace('c2ln', 'b2xk')}`);
        await render(<OrderPage />);
        await settle(() => calls('/orders/view').length === 2);
        await settle(() => text().includes(hi['order.status.DELIVERED']));
        expect(gtag.mock.calls.filter((c) => c[1] === 'purchase')).toHaveLength(0);
    });

    it('the thank-you line promises the details elsewhere only when the phone was proved', async () => {
        await open({ placedHere: true, phoneProved: true });
        await settle(() => text().includes(hi['order.thanks']));
        expect(text()).toContain(hi['order.thanksBody']);
        await act(async () => root?.unmount());
        document.body.innerHTML = '';
        // Another tab, where nothing proved the phone for this order.
        window.sessionStorage.clear();
        resetOrderHandoffMemory();
        await open({ placedHere: true, phoneProved: false });
        await settle(() => text().includes(hi['order.thanks']));
        expect(text()).toContain(hi['order.thanksBodyStatusOnly']);
        expect(text()).not.toContain(hi['order.thanksBody']);
    });

    it('"Pay now" on the order page: the paid time is kept with the order, so a reload still waits', async () => {
        orderView = view({ status: 'PENDING_PAYMENT', payment_status: 'PENDING', payment_retryable: true, hold_expires_at: '2030-01-01T00:00:00Z' });
        const state = await open({ phoneProved: true });
        await settle(() => !!button(hi['checkout.payNow']));
        expect(handoffOf(state)).toMatchObject({ paidAt: null, placedHere: false });
        await click(button(hi['checkout.payNow']));
        await settle(() => calls('/checkout/ord-1/confirm-payment').length === 1);
        await settle(() => handoffOf(state)?.paidAt !== null);
        expect(handoffOf(state)).toMatchObject({ paidAt: expect.any(Number), placedHere: true });
        expect(JSON.stringify(window.history.state)).not.toContain(ORDER_TOKEN);
        await remount();
        await settle(() => text().includes(hi['order.processing.title']));
        expect(button(hi['checkout.payNow'])).toBeNull();
    });

    it('processing: "Confirming your payment" and never a pay button', async () => {
        orderView = view({ status: 'PENDING_PAYMENT', payment_status: 'PENDING', payment_processing: true, payment_retryable: false, hold_expires_at: '2030-01-01T00:00:00Z' });
        await open();
        await settle(() => text().includes(hi['order.processing.title']));
        expect(button(hi['checkout.payNow'])).toBeNull();
    });

    it('unpaid: "Pay now" until the hold ends', async () => {
        orderView = view({ status: 'PENDING_PAYMENT', payment_status: 'PENDING', payment_retryable: true, hold_expires_at: '2030-01-01T00:00:00Z' });
        await open();
        await settle(() => !!button(hi['checkout.payNow']));
    });

    it('COD pending and cancelled wording', async () => {
        orderView = view({ status: 'COD_PENDING_CONFIRMATION', payment_method: 'COD', payment_status: 'PENDING' });
        await open();
        await settle(() => text().includes(hi['order.status.COD_PENDING_CONFIRMATION']));
        await act(async () => root?.unmount());
        document.body.innerHTML = '';
        orderView = view({ status: 'CANCELLED', cancel_reason: 'PAYMENT_EXPIRED' });
        await open();
        await settle(() => text().includes(hi['order.cancel.PAYMENT_EXPIRED']));
        expect(text()).toContain(hi['order.shopAgain']);
    });

    it('without a token: links to track and account, and no request', async () => {
        expect(window.sessionStorage.getItem(orderHandoffKey('inst-1'))).toBeNull();
        window.history.replaceState(null, '', '/shop/order');
        await render(<OrderPage />);
        expect(text()).toContain(hi['order.noToken.title']);
        expect(calls('/orders/view')).toHaveLength(0);
    });
});

describe('track order', () => {
    it('sends no code before an order number; a wrong number says so', async () => {
        await render(<TrackOrderPage />);
        await type(field(hi['form.phone']), '9876543210');
        const disabled = button(hi['track.sendCode']);
        expect(disabled?.disabled).toBe(true);
        await type(field(hi['track.orderNumber']), 'ORD-999999');
        await settle(() => !button(hi['track.sendCode'])?.disabled);
        await click(button(hi['track.sendCode']));
        await settle(() => !!document.querySelector('input[autocomplete="one-time-code"]'));
        expect(calls('/otp/request')[0]!.body).toMatchObject({ purpose: 'TRACK_ORDER', phone: '+919876543210' });
        await type(document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement, '654321');
        await settle(() => text().includes(hi['track.notFound']));
        expect(calls('/orders/track')[0]!.body).toEqual({ order_number: 'ORD-999999', phone_token: 'v1.cGhvbmU.c2ln' });
    });
});

describe('track order, masked', () => {
    it('an order placed with the number without a code shows its state only', async () => {
        trackAnswer = { status: 200, body: { order_number: 'ORD-000077', status: 'SHIPPED', placed_at: '2026-11-01T10:00:00Z', payment_retryable: false, payment_processing: false, timeline: [{ status: 'SHIPPED', at: '2026-11-03T10:00:00Z' }], masked: true } };
        await render(<TrackOrderPage />);
        await type(field(hi['track.orderNumber']), 'ORD-000077');
        await type(field(hi['form.phone']), '9876543210');
        await settle(() => !button(hi['track.sendCode'])?.disabled);
        await click(button(hi['track.sendCode']));
        await settle(() => !!document.querySelector('input[autocomplete="one-time-code"]'));
        await type(document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement, '654321');
        await settle(() => text().includes(hi['track.masked']));
        expect(text()).toContain('ORD-000077');
        expect(text()).not.toContain('₹');
        expect(text()).not.toContain(hi['order.deliverTo']);
    });
});

describe('account', () => {
    it('without a session: the phone gate', async () => {
        await render(<AccountPage />);
        expect(text()).toContain(hi['account.gate.body']);
        expect(calls('/me')).toHaveLength(0);
    });

    it('with a session: orders (masked rows greyed, no link), then sign out everywhere', async () => {
        window.localStorage.setItem('cmx.session.v1.inst-1', JSON.stringify({ token: SESSION, expiresAt: Date.now() + 3_600_000, phoneMasked: '••••••3210' }));
        myOrders = {
            orders: [
                { order_number: 'ORD-000123', status: 'CONFIRMED', placed_at: '2026-11-15T10:00:00Z', total: 4979, currency: 'INR', item_count: 1, first_item_name: 'लाल साड़ी', order_access_token: ORDER_TOKEN, masked: false },
                { order_number: 'ORD-000077', status: 'SHIPPED', placed_at: '2026-11-01T10:00:00Z', masked: true },
            ],
            page: 0,
            page_size: 20,
            total: 2,
        };
        await render(<AccountPage />);
        await settle(() => text().includes('ORD-000077'));
        expect(calls('/me/orders')[0]!.headers['X-Commerce-Session']).toBe(SESSION);
        const rows = Array.from(document.querySelectorAll('.cmx-order-row'));
        expect(rows).toHaveLength(2);
        expect(rows[1]!.classList.contains('cmx-order-row--masked')).toBe(true);
        expect(rows[1]!.querySelector('a[href*="order"]')).toBeNull();
        expect(rows[1]!.textContent).not.toContain('₹');
        // "View order" keeps the token in this tab's sessionStorage, never in an address or the history state.
        expect(document.body.innerHTML).not.toContain(ORDER_TOKEN);
        await click(Array.from(rows[0]!.querySelectorAll('button')).find((b) => b.textContent === hi['account.viewOrder']));
        expect(router.navigate[0]).toBe('/shop/order');
        expectKeyOnly(router.states[0]);
        expect(handoffOf(router.states[0])).toMatchObject({ token: ORDER_TOKEN, placedHere: false, phoneProved: true });
        await click(button(hi['account.signOutEverywhere']));
        await settle(() => text().includes(hi['account.gate.body']));
        expect(calls('/me/logout')[0]!.headers['X-Commerce-Session']).toBe(SESSION);
        expect(window.localStorage.getItem('cmx.session.v1.inst-1')).toBeNull();
    });

    it('a refused session clears it and shows the gate again', async () => {
        window.localStorage.setItem('cmx.session.v1.inst-1', JSON.stringify({ token: SESSION, expiresAt: Date.now() + 3_600_000, phoneMasked: '••••••3210' }));
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'session_invalid' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
        await render(<AccountPage />);
        await settle(() => text().includes(hi['account.signInAgain']));
        expect(window.localStorage.getItem('cmx.session.v1.inst-1')).toBeNull();
    });
});
