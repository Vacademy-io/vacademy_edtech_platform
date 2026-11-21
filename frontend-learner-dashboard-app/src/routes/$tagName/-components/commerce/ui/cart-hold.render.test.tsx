// @vitest-environment jsdom
/**
 * The cart keeps its shape while it is priced: the free-delivery bar's room is held (same
 * fixed-height box) until the server answers, the totals keep their rows, and "updating prices"
 * is said to screen readers instead of drawn. A shop whose answer has no free-delivery amount
 * stops holding the room from then on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ location: { pathname: '/shop/cart', search: '', hash: '', searchStr: '' } }));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({
        history: { location: router.location, replace: () => undefined },
        navigate: () => Promise.resolve(),
        latestLocation: { search: {} },
    }),
    useNavigate: () => () => Promise.resolve(),
    useLocation: (opts?: { select?: (location: unknown) => unknown }) => (opts?.select ? opts.select(router.location) : router.location),
    useParams: () => ({}),
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCommerceCart } from '../state/cart-store';
import { CartPage } from './Cart';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const SETTINGS = { commerce: { enabled: true, publishableKey: KEY, whatsappNumber: '+919876543210' } };
const FLAG = 'commerce-freebar:inst-1:shop';

const price = (freeAbove: number | null) => ({
    currency: 'INR',
    payment_method: 'PREPAID',
    lines: [{ line_ref: 'v1', variant_id: 'v1', sku: 'L-1', slug: 'lamp', name: 'दीया', variant_label: null, quantity: 1, qty_scale: 1, qty_step: 1, piece: false, unit: 'PCS', unit_price: 450, compare_at_price: null, gross: 450, discount: 0, net: 450 }],
    unavailable: [],
    changes: [],
    discounts: [],
    coupon: null,
    shipping: { basis: 'FLAT', charge: 80, charge_before_free: 80, free: false, free_above: freeAbove, remaining_for_free: freeAbove ? freeAbove - 450 : null },
    cod: null,
    tax: { head: 'CGST_SGST', tax_amount: 21.43 },
    totals: { subtotal: 450, discount: 0, shipping: 80, cod_charge: 0, round_off: 0, total: 530, line_count: 1 },
});

let answer: unknown = price(1499);
let gate: Promise<void> | null = null;
let fail = false;

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/cart/price')) {
            if (gate) await gate;
            return fail ? json({ error: { code: 'internal' } }, 500) : json(answer);
        }
        return json({ data: [], total: 0, page: 1, page_size: 4, has_more: false, locale: 'hi' });
    });

let root: Root | null = null;
let container: HTMLDivElement;

const render = async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={SETTINGS}>
                    <CartPage />
                </CommerceSiteProvider>
            </QueryClientProvider>
        );
    });
};

const settle = async (until: () => boolean, tries = 80) => {
    for (let i = 0; i < tries && !until(); i += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    }
    expect(until()).toBe(true);
};

const hold = () => container.querySelector('[data-testid="cmx-freebar-hold"]');
const bar = () => container.querySelector('.cmx-freebar[role="status"]');
const realTotals = () => container.querySelector('dl.cmx-totals:not([aria-hidden])');

beforeEach(() => {
    answer = price(1499);
    fail = false;
    gate = null;
    window.localStorage.clear();
    useCommerceCart.setState({
        key: 'commerce-cart:inst-1:shop',
        hydrated: true,
        drawerOpen: false,
        lastAdded: null,
        cart: { version: 1, pincode: null, lines: [{ variantId: 'v1', slug: 'lamp', name: 'दीया', variantLabel: null, imageUrl: null, quantity: 1, qtyScale: 1, qtyStep: 1, unit: 'PCS', piece: false, unitPrice: 450, addedAt: 1 }] },
    });
    stubApi();
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('the cart while it is priced', () => {
    it('holds the free-delivery bar room above the lines, then puts the bar in the same box', async () => {
        let open: () => void = () => undefined;
        gate = new Promise<void>((resolve) => {
            open = resolve;
        });
        await render();
        await settle(() => !!hold());
        // The held box is the bar's own fixed-height box, first in the column, above the lines.
        expect(hold()!.className).toContain('cmx-freebar');
        const column = hold()!.parentElement!;
        expect(column.firstElementChild).toBe(hold());
        expect(column.querySelector('ul.cmx-rows')).toBeTruthy();
        // The totals keep their rows (labels drawn, amounts to come); "updating" is not drawn.
        const skeleton = container.querySelector('dl.cmx-totals[aria-hidden="true"]')!;
        expect(Array.from(skeleton.querySelectorAll('dt')).map((dt) => dt.textContent)).toEqual(['सामान का मूल्य', 'डिलीवरी', 'कुल']);
        const status = Array.from(container.querySelectorAll('[role="status"]')).find((el) => el.textContent === 'कीमतें अपडेट हो रही हैं…');
        expect(status?.className).toBe('cmx-sr');
        await act(async () => open());
        await settle(() => !!bar());
        expect(hold()).toBeNull();
        expect(bar()!.className).toContain('cmx-freebar');
        expect(column.firstElementChild).toBe(bar());
        expect(bar()!.querySelector('.cmx-freebar__text')!.textContent).toBe('मुफ़्त डिलीवरी के लिए ₹1,049 और जोड़ें');
        expect(realTotals()).toBeTruthy();
        expect(container.querySelector('dl.cmx-totals[aria-hidden="true"]')).toBeNull();
        expect(window.localStorage.getItem(FLAG)).toBe('1');
    });

    it('a shop without a free-delivery amount holds the room only until it first answers', async () => {
        answer = price(null);
        await render();
        await settle(() => !!realTotals());
        expect(bar()).toBeNull();
        expect(hold()).toBeNull();
        expect(window.localStorage.getItem(FLAG)).toBe('0');
        await act(async () => root?.unmount());
        // Next time, nothing is held while it prices.
        gate = new Promise<void>(() => undefined);
        await render();
        await settle(() => !!container.querySelector('dl.cmx-totals[aria-hidden="true"]'));
        expect(hold()).toBeNull();
    });

    it('holds nothing once pricing has failed', async () => {
        fail = true;
        await render();
        await settle(() => !container.querySelector('dl.cmx-totals[aria-hidden="true"]'));
        expect(hold()).toBeNull();
        expect(bar()).toBeNull();
    });
});
