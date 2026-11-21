// @vitest-environment jsdom
/**
 * Goods sold by length in the cart and on the order page: the length with its unit, the price
 * of a metre, a stepper that moves by the step, unavailable and fix messages that carry the
 * unit, a fix that never offers more than the limit, and cancelled lengths in metres.
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

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CartLine } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import { OrderBody } from './buy-common';
import { CartPage } from './Cart';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const SETTINGS = { commerce: { enabled: true, publishableKey: KEY } };

/** ₹123.40 a metre, priced per 10 cm; sold in steps of 0.5 m. */
const line = (variantId: string, name: string, quantity: number, qtyStep: number): CartLine => ({
    variantId,
    slug: variantId,
    name,
    variantLabel: null,
    imageUrl: null,
    quantity,
    qtyScale: 10,
    qtyStep,
    unit: 'MTR',
    piece: false,
    unitPrice: 12.34,
    addedAt: 1,
});

const pricedLine = (ref: string, name: string, quantity: number, qtyStep: number) => ({
    line_ref: ref,
    variant_id: ref,
    sku: ref.toUpperCase(),
    slug: ref,
    name,
    variant_label: null,
    quantity,
    qty_scale: 10,
    qty_step: qtyStep,
    piece: false,
    unit: 'MTR',
    unit_price: 12.34,
    compare_at_price: null,
    gross: Math.round(1234 * quantity) / 100,
    discount: 0,
    net: Math.round(1234 * quantity) / 100,
});

const unavailable = (ref: string, reason: string, over: Record<string, number | null>) => ({
    line_ref: ref,
    variant_id: ref,
    sku: ref.toUpperCase(),
    reason,
    available_quantity: null,
    qty_step: null,
    max_quantity: null,
    ...over,
});

let answer: Record<string, unknown> = {};

const answerFor = (quantity: number) => ({
    currency: 'INR',
    payment_method: 'PREPAID',
    lines: [pricedLine('cotton', 'Cotton cloth', quantity, 5)],
    unavailable: [
        // 2.5 m allowed per order, sold in steps of 1 m: the fix offers 2 m, never 3 m.
        unavailable('linen', 'QUANTITY_ABOVE_MAX', { max_quantity: 25, qty_step: 10 }),
        unavailable('grey', 'INSUFFICIENT_STOCK', { available_quantity: 15 }),
        unavailable('white', 'QUANTITY_STEP', { qty_step: 5 }),
        // 0.4 m left of a cloth cut in steps of 0.5 m: floored, nothing (an older server's answer).
        unavailable('brown', 'INSUFFICIENT_STOCK', { available_quantity: 0, qty_step: 5 }),
        // The same case as the server answers it now.
        unavailable('black', 'OUT_OF_STOCK', { qty_step: 5 }),
        // Off the step: two lengths added up (3.8 m), the step raised to 1 m after 2.5 m was
        // added, 30.3 m above the 25 m per-order maximum, and 0.3 m below one step.
        unavailable('olive', 'QUANTITY_STEP', { qty_step: 5 }),
        unavailable('navy', 'QUANTITY_STEP', { qty_step: 10 }),
        unavailable('tan', 'QUANTITY_STEP', { qty_step: 5 }),
        unavailable('rust', 'QUANTITY_STEP', { qty_step: 5 }),
    ],
    // ₹12.34 → ₹13.01 per 10 cm: the notice names the price of a metre.
    changes: [{ line_ref: 'cotton', variant_id: 'cotton', type: 'PRICE_CHANGED', reason: null, old_unit_price: 12.34, new_unit_price: 13.01 }],
    discounts: [],
    coupon: null,
    shipping: { basis: 'FLAT', charge: 0, charge_before_free: 0, free: true, free_above: null, remaining_for_free: null },
    cod: null,
    tax: { head: 'CGST_SGST', tax_amount: 0 },
    totals: { subtotal: Math.round(1234 * quantity) / 100, discount: 0, shipping: 0, cod_charge: 0, round_off: 0, total: Math.round(1234 * quantity) / 100, line_count: 1 },
});

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/cart/price')) {
            const body = JSON.parse(String(init?.body || '{}')) as { lines?: Array<{ variant_id?: string; quantity?: number }> };
            const cotton = (body.lines || []).find((l) => l.variant_id === 'cotton');
            answer = answerFor(cotton?.quantity ?? 25);
            return json(answer);
        }
        return json({ data: [], total: 0, page: 1, page_size: 4, has_more: false, locale: 'hi' });
    });

let root: Root | null = null;
let container: HTMLDivElement;

const render = async (node: React.ReactNode) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={SETTINGS}>
                    {node}
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

const rowOf = (name: string) =>
    Array.from(container.querySelectorAll('li.cmx-line')).find((li) => li.textContent?.includes(name)) as HTMLElement | undefined;

beforeEach(() => {
    window.localStorage.clear();
    useCommerceCart.setState({
        key: 'commerce-cart:inst-1:shop',
        hydrated: true,
        drawerOpen: false,
        lastAdded: null,
        cart: {
            version: 1,
            pincode: null,
            lines: [
                line('cotton', 'Cotton cloth', 25, 5),
                line('linen', 'Linen cloth', 30, 10),
                line('grey', 'Grey cloth', 25, 5),
                line('white', 'White cloth', 23, 5),
                line('brown', 'Brown cloth', 5, 5),
                line('black', 'Black cloth', 10, 5),
                line('olive', 'Olive cloth', 38, 5),
                line('navy', 'Navy cloth', 25, 5),
                line('tan', 'Tan cloth', 303, 5),
                line('rust', 'Rust cloth', 3, 5),
            ],
        },
    });
    stubApi();
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('a cloth line in the cart', () => {
    it('shows the length with its unit, the price of a metre, and steps by the step', async () => {
        await render(<CartPage />);
        await settle(() => !!rowOf('Cotton cloth') && !!rowOf('Cotton cloth')!.textContent?.includes('₹308.50'));
        const row = rowOf('Cotton cloth')!;
        expect(row.querySelector('output')?.textContent).toBe('2.5 मी');
        expect(row.textContent).toContain('₹123.40 प्रति मीटर');
        // Never the price of 10 cm.
        expect(row.textContent).not.toContain('₹12.34');
        const increase = row.querySelector<HTMLButtonElement>('button[aria-label="मात्रा बढ़ाएँ"]')!;
        await act(async () => increase.click());
        expect(useCommerceCart.getState().cart.lines.find((l) => l.variantId === 'cotton')!.quantity).toBe(30);
        expect(rowOf('Cotton cloth')!.querySelector('output')?.textContent).toBe('3 मी');
        await settle(() => !!rowOf('Cotton cloth')!.textContent?.includes('₹370.20'));
    });

    it('names the unit in every unavailable message and fix', async () => {
        await render(<CartPage />);
        await settle(() => !!rowOf('Linen cloth')?.querySelector('[role="status"]'));
        const linen = rowOf('Linen cloth')!;
        expect(linen.querySelector('[role="status"]')?.textContent).toContain('एक ऑर्डर में अधिकतम 2.5 मी');
        // The fix floors to the 1 m step: 2 m, never 3 m (above the limit).
        const fix = Array.from(linen.querySelectorAll('button.cmx-link')).find((b) => b.textContent?.endsWith('कर दें'));
        expect(fix?.textContent).toBe('2 मी कर दें');
        await act(async () => (fix as HTMLButtonElement).click());
        expect(useCommerceCart.getState().cart.lines.find((l) => l.variantId === 'linen')!.quantity).toBe(20);

        const grey = rowOf('Grey cloth')!;
        expect(grey.querySelector('[role="status"]')?.textContent).toContain('केवल 1.5 मी उपलब्ध');
        expect(Array.from(grey.querySelectorAll('button.cmx-link')).map((b) => b.textContent)).toContain('1.5 मी कर दें');

        const white = rowOf('White cloth')!;
        expect(white.querySelector('[role="status"]')?.textContent).toContain('मात्रा 0.5 मी के गुणज में होनी चाहिए');
    });

    it('offers the valid length for a line off its step', async () => {
        await render(<CartPage />);
        await settle(() => !!rowOf('Rust cloth')?.querySelector('[role="status"]'));
        const fixOf = (name: string) =>
            Array.from(rowOf(name)!.querySelectorAll<HTMLButtonElement>('button.cmx-link')).find((b) => b.textContent?.endsWith('कर दें'));
        // The nearest valid length at or below the line's, at least one step, at most the
        // per-order maximum (25 m), on the step the server names now.
        expect(rowOf('White cloth')!.querySelector('[role="status"]')?.textContent).toContain('मात्रा 0.5 मी के गुणज में होनी चाहिए');
        expect(fixOf('White cloth')?.textContent).toBe('2 मी कर दें');
        expect(fixOf('Olive cloth')?.textContent).toBe('3.5 मी कर दें');
        expect(fixOf('Navy cloth')?.textContent).toBe('2 मी कर दें');
        expect(fixOf('Tan cloth')?.textContent).toBe('25 मी कर दें');
        expect(fixOf('Rust cloth')?.textContent).toBe('0.5 मी कर दें');
        // The cart now works on the new 1 m step of the navy cloth; the length is not changed by it.
        const navy = () => useCommerceCart.getState().cart.lines.find((l) => l.variantId === 'navy')!;
        expect(navy()).toMatchObject({ quantity: 25, qtyStep: 10 });
        const lineOf = (id: string) => useCommerceCart.getState().cart.lines.find((l) => l.variantId === id)!;
        await act(async () => fixOf('Olive cloth')!.click());
        expect(lineOf('olive').quantity).toBe(35);
        await act(async () => fixOf('Navy cloth')!.click());
        expect(navy().quantity).toBe(20);
        await act(async () => fixOf('Tan cloth')!.click());
        expect(lineOf('tan').quantity).toBe(250);
        await act(async () => fixOf('Rust cloth')!.click());
        expect(lineOf('rust').quantity).toBe(5);
    });

    it('shows a line with less than one step left as sold out, with remove as the fix', async () => {
        await render(<CartPage />);
        await settle(() => !!rowOf('Brown cloth')?.querySelector('[role="status"]'));
        for (const name of ['Brown cloth', 'Black cloth']) {
            const row = rowOf(name)!;
            const said = row.querySelector('[role="status"]')?.textContent || '';
            expect(said, name).toContain('स्टॉक में नहीं');
            // Never "Only 0 m available", and no "set to" fix.
            expect(said, name).not.toContain('केवल');
            expect(said, name).not.toContain('कर दें');
            const fixes = Array.from(row.querySelectorAll<HTMLButtonElement>('button.cmx-link'));
            expect(fixes.map((b) => b.textContent), name).toEqual(['हटाएँ']);
        }
        const remove = rowOf('Brown cloth')!.querySelector<HTMLButtonElement>('button.cmx-link')!;
        await act(async () => remove.click());
        expect(useCommerceCart.getState().cart.lines.map((l) => l.variantId)).not.toContain('brown');
        expect(rowOf('Brown cloth')).toBeUndefined();
    });

    it('names a changed price per metre', async () => {
        await render(<CartPage />);
        await settle(() => !!container.querySelector('.cmx-note--warn'));
        const notice = container.querySelector('.cmx-note--warn')!.textContent || '';
        expect(notice).toContain('₹123.40');
        expect(notice).toContain('₹130.10');
        expect(notice).not.toContain('₹12.34');
    });
});

describe('a cloth line on the order page', () => {
    it('shows the length and the cancelled length in metres', async () => {
        await render(
            <OrderBody
                view={{
                    order_id: 'o1',
                    order_number: 'ORD-1',
                    status: 'CONFIRMED',
                    currency: 'INR',
                    lines: [
                        { line_ref: 'l1', name: 'Cotton cloth', quantity: 25, qty_scale: 10, unit: 'MTR', unit_price: 12.34, line_total: 308.5, qty_cancelled: 10 },
                        { line_ref: 'l2', name: 'Cup', quantity: 2, qty_scale: 1, unit: 'PCS', unit_price: 100, line_total: 200, qty_cancelled: 1 },
                    ],
                    totals: { subtotal: 508.5, total: 508.5 },
                }}
            />
        );
        const rows = Array.from(container.querySelectorAll('ul.cmx-rows > li')).map((li) => li.textContent);
        expect(rows[0]).toContain('मात्रा 2.5 मी');
        // 10 base units cancelled = 1 m, never "10".
        expect(rows[0]).toContain('1 मी रद्द');
        // Pieces are unchanged.
        expect(rows[1]).toContain('मात्रा 2');
        expect(rows[1]).toContain('1 रद्द');
    });
});
