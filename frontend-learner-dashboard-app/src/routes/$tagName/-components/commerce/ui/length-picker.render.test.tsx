// @vitest-environment jsdom
/**
 * The length picker of goods sold by length: preset chips priced for their length, a typed length
 * priced in whole paise, a length moved onto the step said out loud, nothing to buy when less is
 * left than one step, and the "other length" box that follows the quantity when the variant
 * changes. Also the "only N left" card badge with its unit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/shop/p/cotton-cloth', search: '', hash: '', searchStr: '' },
}));

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
import { EMPTY_CART } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import { BUILT_IN_TEMPLATES } from '../templates';
import { resetEdgeHead, resetProductSeed } from './Head';
import { ProductTemplate } from './Product';
import { ProductGrid } from './ProductCard';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const SETTINGS = {
    commerce: { enabled: true, publishableKey: KEY, locales: ['hi', 'en'], lengthPresets: [1, 2.5, 5] },
};

type StockFixture = { state: string; left: number | null; purchasable: boolean; single_piece: boolean; lead_time_days: null };
const stock = (state: string, left: number | null = null): StockFixture => ({ state, left, purchasable: state !== 'OUT', single_piece: false, lead_time_days: null });
const priceOf = (amount: number) => ({ amount, compare_at_amount: null, currency: 'INR', from: false });
const value = (code: string, label: string, position: number) => ({ code, label, swatch_hex: null, position });
const variant = (id: string, colour: string, position: number, left: StockFixture = stock('IN_STOCK')) => ({
    id,
    sku: `CC-${colour.toUpperCase()}`,
    label: colour,
    option_values: { colour },
    price: priceOf(12.34),
    stock: left,
    weight_grams: null,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    image: null,
    position,
});

/** ₹123.40 a metre, priced per 10 cm (₹12.34), sold in steps of 10 cm. */
const COTTON = {
    id: 'p1',
    slug: 'cotton-cloth',
    path: '/p/cotton-cloth',
    locale: 'hi',
    name: 'Cotton cloth',
    short_description: null,
    description_html: null,
    content_blocks: [],
    brand: null,
    unit: 'MTR',
    qty_scale: 10,
    qty_step: 1,
    stock_mode: 'QUANTITY',
    origin: null,
    price: priceOf(12.34),
    stock: stock('IN_STOCK'),
    badges: [],
    media: [],
    options: [{ code: 'colour', name: 'Colour', kind: 'COLOUR', values: [value('white', 'White', 0), value('blue', 'Blue', 1)] }],
    variants: [variant('v-white', 'white', 0), variant('v-blue', 'blue', 1)],
    specs: [],
    collections: [],
    seo: { title: 'Cotton cloth', description: null, canonical_path: '/p/cotton-cloth', alternates: [] },
    published_at: null,
    updated_at: null,
};

/** Sold in steps of 0.5 m. */
const LINEN = {
    ...COTTON,
    id: 'p2',
    slug: 'linen-cloth',
    path: '/p/linen-cloth',
    name: 'Linen cloth',
    qty_step: 5,
    price: priceOf(20),
    options: [],
    variants: [{ ...variant('v-linen', 'natural', 0), option_values: {}, label: null, price: priceOf(20) }],
};

let product: Record<string, unknown> = COTTON;

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname.includes('/products/')) return json(product);
        return json({ data: [], total: 0, page: 1, page_size: 4, has_more: false, locale: 'hi' });
    });

let root: Root | null = null;
let container: HTMLDivElement;

const render = async (node: React.ReactNode, settings: Record<string, unknown> = SETTINGS) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    container.setAttribute('data-catalogue-theme', 'default');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={settings} siteName="Example Shop">
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

const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy();
    await act(async () => {
        (element as HTMLElement).click();
    });
};

/** Types into a React-controlled input and presses Enter. */
const typeLength = async (input: HTMLInputElement, text: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
        setter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
};

const buyButton = () => container.querySelector<HTMLButtonElement>('.cmx-btn--primary.cmx-btn--block');
const chips = () => Array.from(container.querySelectorAll<HTMLButtonElement>('fieldset .cmx-chip'));
const lengthInput = () => container.querySelector<HTMLInputElement>('fieldset input[type="number"]');
const status = (text: string) => Array.from(container.querySelectorAll('[role="status"]')).find((el) => el.textContent === text);

const renderProduct = async (slug: string) => {
    await render(<ProductTemplate slug={slug} sections={BUILT_IN_TEMPLATES.product} />);
    await settle(() => !!container.querySelector('h1') && !!buyButton());
};

beforeEach(() => {
    product = COTTON;
    router.location = { pathname: '/shop/p/cotton-cloth', search: '', hash: '', searchStr: '' };
    resetEdgeHead();
    resetProductSeed();
    window.localStorage.clear();
    useCommerceCart.setState({ key: null, cart: EMPTY_CART, hydrated: false, drawerOpen: false, lastAdded: null });
    stubApi();
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('the length picker', () => {
    it('offers the site presets as chips priced for their length, then "other length"', async () => {
        await renderProduct('cotton-cloth');
        expect(container.querySelector('legend')?.textContent).toBe('लंबाई · ₹123.40 प्रति मीटर');
        expect(chips().map((chip) => chip.textContent)).toEqual(['1 मी₹123.40', '2.5 मी₹308.50', '5 मी₹617', 'दूसरी लंबाई']);
        // One metre to start with: its chip is pressed and the box is closed.
        expect(chips()[0]!.getAttribute('aria-pressed')).toBe('true');
        expect(lengthInput()).toBeNull();
        expect(buyButton()!.textContent).toBe('कार्ट में डालें · ₹123.40');
        await click(chips()[1]);
        expect(buyButton()!.textContent).toBe('कार्ट में डालें · ₹308.50');
    });

    it('prices a typed length in whole paise, on the button and under the box', async () => {
        await renderProduct('cotton-cloth');
        await click(chips()[3]);
        const input = lengthInput()!;
        expect(input).toBeTruthy();
        await typeLength(input, '3.4');
        // 34 × ₹12.34 = ₹419.56 exactly.
        expect(buyButton()!.textContent).toBe('कार्ट में डालें · ₹419.56');
        expect(container.querySelector('[data-testid="cmx-length-total"]')?.textContent).toBe('3.4 मी का मूल्य: ₹419.56');
        // No chip is pressed for a length no chip offers; the box stays open.
        expect(chips().slice(0, 3).every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
        expect(lengthInput()).toBeTruthy();
        // Nothing was moved, so nothing is said.
        expect(status('3.4 मी कर दिया गया')).toBeUndefined();
        await click(buyButton());
        const line = useCommerceCart.getState().cart.lines[0]!;
        expect(line.quantity).toBe(34);
        expect(line.qtyScale).toBe(10);
    });

    it('says when a typed length was moved onto the step', async () => {
        product = LINEN;
        await renderProduct('linen-cloth');
        await click(chips()[3]);
        // 2.3 m is not on the 0.5 m grid: 2.5 m, and the shopper is told.
        await typeLength(lengthInput()!, '2.3');
        expect(status('2.5 मी कर दिया गया')).toBeTruthy();
        expect(buyButton()!.textContent).toBe('कार्ट में डालें · ₹500');
        // 2.5 m is a preset: its chip is pressed now.
        expect(chips()[1]!.getAttribute('aria-pressed')).toBe('true');
    });

    it('sells nothing when less is left than one step', async () => {
        // 0.4 m left of a cloth cut in steps of 0.5 m.
        product = { ...LINEN, stock: stock('LOW', 4), variants: [{ ...LINEN.variants[0]!, stock: stock('LOW', 4) }] };
        await renderProduct('linen-cloth');
        expect(buyButton()!.disabled).toBe(true);
        expect(buyButton()!.textContent).toBe('स्टॉक में नहीं');
        expect(container.querySelector('fieldset')).toBeNull();
        expect(container.textContent).toContain('स्टॉक में नहीं');
        expect(container.textContent).not.toContain('₹0');
        await click(buyButton());
        expect(useCommerceCart.getState().cart.lines).toHaveLength(0);
    });

    it('opens the "other length" box when a new variant starts at a length no chip offers', async () => {
        // Presets 2.5 m and 5 m only: a new variant starts at 1 m, which no chip offers.
        await render(<ProductTemplate slug="cotton-cloth" sections={BUILT_IN_TEMPLATES.product} />, {
            commerce: { ...SETTINGS.commerce, lengthPresets: [2.5, 5] },
        });
        await settle(() => !!buyButton() && chips().length === 3);
        // 1 m to start with: the box is open.
        expect(lengthInput()?.value).toBe('1');
        // The shopper picks 2.5 m: the box closes.
        await click(chips()[0]);
        expect(lengthInput()).toBeNull();
        expect(buyButton()!.textContent).toBe('कार्ट में डालें · ₹308.50');
        // Another colour starts again at 1 m: the box opens with it, so the length on the button is visible.
        await click(container.querySelector('button[role="radio"][aria-checked="false"]'));
        expect(buyButton()!.textContent).toBe('कार्ट में डालें · ₹123.40');
        expect(lengthInput()?.value).toBe('1');
        expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    });
});

describe('the "only N left" card badge', () => {
    it('names the unit of goods sold by length', async () => {
        const card = {
            id: 'p1',
            slug: 'cotton-cloth',
            path: '/p/cotton-cloth',
            locale: 'hi',
            name: 'Cotton cloth',
            short_description: null,
            brand: null,
            unit: 'MTR',
            qty_scale: 10,
            qty_step: 1,
            origin: null,
            image: null,
            price: priceOf(12.34),
            stock: stock('LOW', 25),
            badges: ['ONLY_N_LEFT'],
            swatches: [],
            variant_count: 1,
            default_variant_id: 'v-white',
            published_at: null,
        };
        await render(<ProductGrid products={[card as never, { ...card, id: 'p3', slug: 'cup', unit: 'PCS', qty_scale: 1, stock: stock('LOW', 2) } as never]} />);
        const badges = Array.from(container.querySelectorAll('.cmx-badge')).map((b) => b.textContent);
        expect(badges).toContain('केवल 2.5 मी बचे');
        // Pieces are unchanged.
        expect(badges).toContain('केवल 2 बचे');
    });
});
