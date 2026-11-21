// @vitest-environment jsdom
/**
 * The order page opened from an order message ("order#l=<link token>", contract WP-33 §4.4),
 * rendered in jsdom against a stubbed public API: the fragment leaves the address before the
 * exchange is asked, the order token it answers is kept like every other (random key in
 * history.state, token in sessionStorage) and the link token itself is kept nowhere; 410 shows
 * the expired page, 403 and 400 the page without an order, 429 the retry; `purchase` is never
 * sent; an older "#t=" link still opens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/shop/order', search: '', hash: '', searchStr: '' },
    navigate: [] as string[],
    replaced: [] as string[],
}));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({
        history: { location: router.location, replace: (href: string) => void router.replaced.push(href) },
        navigate: ({ href }: { href: string }) => {
            router.navigate.push(href);
            return Promise.resolve();
        },
        latestLocation: { search: {} },
    }),
    useNavigate: () => () => Promise.resolve(),
    useLocation: (opts?: { select?: (location: unknown) => unknown }) => (opts?.select ? opts.select(router.location) : router.location),
    useParams: () => ({}),
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hi } from '../i18n/messages.hi';
import { ORDER_KEY_STATE, orderHandoffKey, readOrderHandoff, resetOrderHandoffMemory } from '../state/order-handoff';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HELD_ORDER_LINK } from '../logic/checkout';
import { OrderPage, takeOrder } from './OrderPage';
import { CommerceSiteProvider, useCommerceSite } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'d4'.repeat(24)}`;
const SETTINGS = { commerce: { enabled: true, checkout: true, publishableKey: KEY, whatsappNumber: '+919800000000' } };
const LINK_TOKEN = 'l1.abc.def';
const ORDER_TOKEN = 'v1.b3JkZXI.c2ln';
const OLD_ORDER_TOKEN = 'v1.b2xk.c2ln';

type Json = Record<string, unknown>;
type Answer = { status: number; body: Json };
let linkAnswers: Answer[];
/** When set, the exchange waits for it before answering. */
let linkGate: Promise<void> | null;
const requests: Array<{ url: string; path: string; method: string; headers: Record<string, string>; body: Json | null; hash: string; href: string; state: string }> = [];

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
    lines: [{ line_ref: 'v1', name: 'Example item', sku: 'SKU-1', quantity: 1, qty_scale: 1, unit: 'PCS', unit_price: 4899, line_total: 4899 }],
    totals: { subtotal: 4899, shipping: 80, tax: 233.29, total: 4979 },
    recipient: { name: 'Asha', phone_masked: '••••••3210', city: 'Varanasi', state_code: '09', pincode: '221001' },
    timeline: [{ status: 'CONFIRMED', at: '2026-11-15T10:01:00Z' }],
    ...extra,
});

const exchanged = (extra: Json = {}): Answer => ({
    status: 200,
    body: { order_access_token: ORDER_TOKEN, order_access_token_expires_at: '2030-01-01T00:00:00Z', phone_verified: true, ...extra },
});

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname.replace('/admin-core-service/open/commerce/v1', '');
        // What the address bar and the history entry held at the moment of the request.
        requests.push({
            url: url.toString(),
            path,
            method: init?.method || 'GET',
            headers: (init?.headers || {}) as Record<string, string>,
            body: init?.body ? (JSON.parse(init.body as string) as Json) : null,
            hash: window.location.hash,
            href: window.location.href,
            state: JSON.stringify(window.history.state),
        });
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (path === '/orders/link') {
            if (linkGate) await linkGate;
            const next = linkAnswers.shift() || exchanged();
            return json(next.status === 200 ? next.body : { error: next.body }, next.status);
        }
        if (path === '/orders/view') return json(view());
        if (path === '/me') return json({ error: { code: 'session_invalid' } }, 401);
        return json({ error: { code: 'not_found' } }, 404);
    });

let root: Root | null = null;

/** The page's language switch, reached from a probe inside the same provider. */
const site: { setLocale?: (code: string) => void } = {};
const SiteProbe = () => {
    site.setLocale = useCommerceSite().setLocale;
    return null;
};

const render = async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div');
    container.setAttribute('data-catalogue-theme', 'default');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={SETTINGS} siteName="Example Shop">
                    <OrderPage />
                    <SiteProbe />
                </CommerceSiteProvider>
            </QueryClientProvider>
        );
    });
};

const remount = async () => {
    await act(async () => root?.unmount());
    document.body.innerHTML = '';
    await render();
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
const calls = (path: string) => requests.filter((r) => r.path === path);
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes(label)) || null;
const linkTo = (label: string) => Array.from(document.querySelectorAll('a')).find((a) => (a.textContent || '').includes(label)) || null;

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

/** Every key and value a storage holds, in one string. */
const dump = (storage: Storage) => {
    const out: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)!;
        out.push(key, storage.getItem(key) || '');
    }
    return out.join('\n');
};

const openLink = async (fragment = `#l=${LINK_TOKEN}`) => {
    window.history.replaceState(null, '', `/shop/order${fragment}`);
    await render();
};

let gtag: ReturnType<typeof vi.fn>;

beforeEach(() => {
    resetOrderHandoffMemory();
    Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), configurable: true });
    requests.length = 0;
    router.navigate.length = 0;
    router.replaced.length = 0;
    router.location.hash = '';
    delete (window as unknown as Record<string, unknown>)[HELD_ORDER_LINK];
    linkAnswers = [];
    linkGate = null;
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    (window as unknown as { dataLayer: unknown[] }).dataLayer = [];
    stubApi();
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    delete (window as unknown as { gtag?: unknown }).gtag;
    delete (window as unknown as { dataLayer?: unknown }).dataLayer;
});

const purchaseSent = () =>
    gtag.mock.calls.some((c) => c[1] === 'purchase') ||
    ((window as unknown as { dataLayer: Array<{ event?: string }> }).dataLayer || []).some((e) => (e?.event || '').includes('purchase'));

describe('order page opened from an order link', () => {
    it('removes "#l=" from the address before the exchange, then keeps only the order token, like every order', async () => {
        let open!: () => void;
        linkGate = new Promise<void>((resolve) => {
            open = resolve;
        });
        await openLink();
        // Opening: the skeleton with its line, the exchange already asked.
        await settle(() => calls('/orders/link').length === 1);
        expect(text()).toContain(hi['order.linkOpening']);
        const exchange = calls('/orders/link')[0]!;
        expect(exchange.hash).toBe('');
        expect(exchange.href).not.toContain(LINK_TOKEN);
        expect(exchange.state).not.toContain(LINK_TOKEN);
        expect(exchange.method).toBe('POST');
        expect(exchange.url).not.toContain(LINK_TOKEN);
        expect(exchange.headers['X-API-Key']).toBe(KEY);
        expect(exchange.body).toEqual({ link_token: LINK_TOKEN });
        expect(calls('/orders/view')).toHaveLength(0);

        await act(async () => open());
        await settle(() => text().includes(hi['order.thanks']));
        // The hand-off record: the exchanged token, phone proved, not placed here.
        const record = readOrderHandoff('inst-1', window.history.state, window.sessionStorage);
        expect(record).toMatchObject({ token: ORDER_TOKEN, phoneProved: true, placedHere: false, paidAt: null });
        expect(window.sessionStorage.getItem(orderHandoffKey('inst-1'))).toContain(ORDER_TOKEN);
        // The history entry holds the random key only.
        expect(Object.keys(window.history.state as Json)).toEqual([ORDER_KEY_STATE]);
        expect(JSON.stringify(window.history.state)).not.toContain(LINK_TOKEN);
        expect(JSON.stringify(window.history.state)).not.toContain(ORDER_TOKEN);
        // The link token is nowhere: address, history, either storage.
        expect(window.location.href).not.toContain(LINK_TOKEN);
        expect(window.location.hash).toBe('');
        expect(dump(window.localStorage)).not.toContain(LINK_TOKEN);
        expect(dump(window.sessionStorage)).not.toContain(LINK_TOKEN);
        // The order is read with the exchanged token, in its header.
        expect(calls('/orders/view')[0]!.headers['X-Commerce-Order-Token']).toBe(ORDER_TOKEN);
        expect(text()).toContain(hi['order.thanksBody']);
        expect(purchaseSent()).toBe(false);

        // A reload finds the same order through the key, without asking the exchange again.
        await remount();
        await settle(() => calls('/orders/view').length === 2);
        expect(calls('/orders/view')[1]!.headers['X-Commerce-Order-Token']).toBe(ORDER_TOKEN);
        expect(calls('/orders/link')).toHaveLength(1);
        expect(purchaseSent()).toBe(false);
    });

    it('an unproved phone: the thank-you line promises the status only', async () => {
        linkAnswers = [exchanged({ phone_verified: false })];
        await openLink();
        await settle(() => text().includes(hi['order.thanks']));
        expect(text()).toContain(hi['order.thanksBodyStatusOnly']);
        expect(readOrderHandoff('inst-1', window.history.state, window.sessionStorage)).toMatchObject({ phoneProved: false });
    });

    it('410: the expired page, with links to track the order and to the account', async () => {
        linkAnswers = [{ status: 410, body: { code: 'link_expired', message: 'x' } }];
        await openLink();
        await settle(() => text().includes(hi['order.linkExpired.title']));
        expect(text()).toContain(hi['order.linkExpired.body']);
        expect(linkTo(hi['track.title'])?.getAttribute('href')).toContain('track-order');
        expect(linkTo(hi['account.seeOrders'])?.getAttribute('href')).toContain('account');
        expect(button(hi['common.retry'])).toBeNull();
        expect(window.location.hash).toBe('');
        expect(calls('/orders/view')).toHaveLength(0);
        expect(window.sessionStorage.getItem(orderHandoffKey('inst-1'))).toBeNull();
        expect(dump(window.localStorage)).not.toContain(LINK_TOKEN);
    });

    it('403 and 400: the page without an order', async () => {
        linkAnswers = [{ status: 403, body: { code: 'link_invalid', message: 'x' } }];
        await openLink();
        await settle(() => text().includes(hi['order.noToken.title']));
        expect(linkTo(hi['track.title'])?.getAttribute('href')).toContain('track-order');
        expect(calls('/orders/view')).toHaveLength(0);
        expect(window.location.hash).toBe('');

        await act(async () => root?.unmount());
        document.body.innerHTML = '';
        linkAnswers = [{ status: 400, body: { code: 'invalid_request', message: 'x' } }];
        await openLink();
        await settle(() => calls('/orders/link').length === 2 && text().includes(hi['order.noToken.title']));
        expect(calls('/orders/view')).toHaveLength(0);
    });

    it('429: the error page with Retry, which exchanges the same link again', async () => {
        linkAnswers = [{ status: 429, body: { code: 'rate_limited', message: 'x' } }, exchanged()];
        await openLink();
        await settle(() => !!button(hi['common.retry']));
        expect(window.location.hash).toBe('');
        expect(text()).not.toContain(hi['order.noToken.title']);
        await act(async () => {
            button(hi['common.retry'])!.click();
        });
        await settle(() => text().includes(hi['order.thanks']));
        expect(calls('/orders/link')).toHaveLength(2);
        expect(calls('/orders/link')[1]!.body).toEqual({ link_token: LINK_TOKEN });
        expect(calls('/orders/link')[1]!.hash).toBe('');
        expect(JSON.stringify(window.history.state)).not.toContain(LINK_TOKEN);
        expect(purchaseSent()).toBe(false);
    });

    it('a server error also offers Retry; after a reload the link is gone and nothing is asked again', async () => {
        linkAnswers = [{ status: 503, body: { code: 'checkout_not_configured', message: 'x' } }];
        await openLink();
        await settle(() => !!button(hi['common.retry']));
        await remount();
        expect(text()).toContain(hi['order.noToken.title']);
        expect(calls('/orders/link')).toHaveLength(1);
    });

    it('an "l" that is not a link token leaves the address and opens nothing', async () => {
        await openLink('#l=%3Cscript%3E');
        expect(window.location.hash).toBe('');
        expect(text()).toContain(hi['order.noToken.title']);
        expect(requests).toHaveLength(0);
    });

    it('the link wins over a "t" in the same fragment', async () => {
        await openLink(`#t=${OLD_ORDER_TOKEN}&l=${LINK_TOKEN}`);
        await settle(() => text().includes(hi['order.thanks']));
        expect(calls('/orders/link')[0]!.hash).toBe('');
        expect(calls('/orders/view')[0]!.headers['X-Commerce-Order-Token']).toBe(ORDER_TOKEN);
        expect(dump(window.sessionStorage)).not.toContain(OLD_ORDER_TOKEN);
    });

    it('an older "#t=" link still opens without any exchange', async () => {
        window.history.replaceState(null, '', `/shop/order#t=${OLD_ORDER_TOKEN}`);
        await render();
        await settle(() => calls('/orders/view').length === 1);
        expect(calls('/orders/link')).toHaveLength(0);
        expect(window.location.hash).toBe('');
        expect(Object.keys(window.history.state as Json)).toEqual([ORDER_KEY_STATE]);
        expect(calls('/orders/view')[0]!.headers['X-Commerce-Order-Token']).toBe(OLD_ORDER_TOKEN);
        await settle(() => text().includes(hi['order.thanks']));
        expect(purchaseSent()).toBe(false);
    });
});

/** The early script of index.html, run as written in this window (as the browser runs it first). */
const runEarlyScript = () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const match = html.match(/<script>\s*\/\/ Sign-in hand-off[\s\S]*?<\/script>/);
    if (!match) throw new Error('no early script in index.html');
    new Function(match[0].replace(/<\/?script>/g, ''))();
};

describe('order link taken by the early script in index.html', () => {
    it('the address holds no token once the app starts; the page exchanges the held token once', async () => {
        window.history.replaceState(null, '', `/shop/order#l=${LINK_TOKEN}`);
        runEarlyScript();
        // This is the address every later script (Sentry, the router, tracking) starts from.
        expect(window.location.hash).toBe('');
        expect(window.location.href).not.toContain(LINK_TOKEN);
        expect(JSON.stringify(window.history.state)).not.toContain(LINK_TOKEN);
        expect(Object.keys(window)).not.toContain(HELD_ORDER_LINK);
        expect(dump(window.sessionStorage)).not.toContain(LINK_TOKEN);
        expect(dump(window.localStorage)).not.toContain(LINK_TOKEN);

        await render();
        await settle(() => text().includes(hi['order.thanks']));
        expect(calls('/orders/link')).toHaveLength(1);
        expect(calls('/orders/link')[0]!.body).toEqual({ link_token: LINK_TOKEN });
        expect(calls('/orders/link')[0]!.href).not.toContain(LINK_TOKEN);
        // Read once: the holder is gone, and nothing else can take it again.
        expect(HELD_ORDER_LINK in window).toBe(false);
        expect(takeOrder('inst-1')).not.toMatchObject({ linkToken: LINK_TOKEN });
        expect(calls('/orders/view')[0]!.headers['X-Commerce-Order-Token']).toBe(ORDER_TOKEN);
        expect(purchaseSent()).toBe(false);
    });

    it('leaves a non-order page alone', () => {
        window.history.replaceState(null, '', `/shop/checkout#l=${LINK_TOKEN}`);
        runEarlyScript();
        expect(window.location.hash).toBe(`#l=${LINK_TOKEN}`);
        expect(HELD_ORDER_LINK in window).toBe(false);
        window.history.replaceState(null, '', '/shop/order#details');
        runEarlyScript();
        expect(window.location.hash).toBe('#details');
        expect(HELD_ORDER_LINK in window).toBe(false);
    });
});

describe('a language switch on the order page', () => {
    it('never puts a link token back, even when the router still remembers the old fragment', async () => {
        // An older cached index.html: the page itself took the fragment out; the router's own
        // record of the address may still hold it.
        router.location.hash = `#l=${LINK_TOKEN}`;
        await openLink();
        await settle(() => text().includes(hi['order.thanks']));
        expect(window.location.hash).toBe('');
        await act(async () => site.setLocale!('en'));
        expect(router.replaced).toHaveLength(1);
        expect(router.replaced[0]).toBe('/shop/order?lang=en');
        expect(router.replaced.join(' ')).not.toContain(LINK_TOKEN);
    });

    it('nor an order token; an ordinary anchor is kept', async () => {
        router.location.hash = `#t=${OLD_ORDER_TOKEN}`;
        window.history.replaceState(null, '', `/shop/order#t=${OLD_ORDER_TOKEN}`);
        await render();
        await settle(() => calls('/orders/view').length === 1);
        await act(async () => site.setLocale!('en'));
        expect(router.replaced.at(-1)).toBe('/shop/order?lang=en');

        router.location.hash = '#details';
        await act(async () => site.setLocale!('hi'));
        expect(router.replaced.at(-1)).toBe('/shop/order#details');
    });
});

