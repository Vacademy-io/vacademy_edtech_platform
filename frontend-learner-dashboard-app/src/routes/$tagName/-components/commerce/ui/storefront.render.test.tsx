// @vitest-environment jsdom
/**
 * The shop pages rendered in jsdom against a stubbed public API: what a shopper is shown for a
 * product (price, stock, options, safe HTML), that "Add to cart" fills the local cart and the
 * drawer shows the SERVER's totals, and that a listing writes its filters into the address.
 * Layout, touch gestures and real network behaviour are not covered here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/p/red-saree', search: '', hash: '', searchStr: '' },
    replace: [] as string[],
    navigate: [] as string[],
}));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({
        history: {
            location: router.location,
            replace: (href: string) => void router.replace.push(href),
        },
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

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EMPTY_CART } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import { CartDrawer } from './Cart';
import { CollectionTemplate } from './Listing';
import { ProductTemplate } from './Product';
import { CommerceSiteProvider } from './site';
import { BUILT_IN_TEMPLATES } from '../templates';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const SETTINGS = {
    commerce: {
        enabled: true,
        publishableKey: KEY,
        whatsappNumber: '+919876543210',
        media: { leadTag: 'REAL', tagLabels: { RENDER: 'Styled render' } },
        reassurance: [{ label: 'Ships in 2 working days', text: 'Sent by courier.' }],
    },
};

const stock = (state: string, left: number | null = null) => ({ state, left, purchasable: state !== 'OUT', single_piece: false, lead_time_days: null });
const priceOf = (amount: number, compare: number | null = null) => ({ amount, compare_at_amount: compare, currency: 'INR', from: false });
const value = (code: string, label: string, position: number, hex: string | null = null) => ({ code, label, swatch_hex: hex, position });
const variant = (id: string, colour: string, size: string, state: string, position: number, left: number | null = null) => ({
    id,
    sku: `SAR-${id}`,
    label: `${colour} / ${size}`,
    option_values: { colour, size },
    price: priceOf(4899, 5999),
    stock: stock(state, left),
    weight_grams: 650,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    image: null,
    position,
});

const PRODUCT = {
    id: 'p1',
    slug: 'red-saree',
    path: '/p/red-saree',
    locale: 'hi',
    name: 'लाल सूती साड़ी',
    short_description: 'हाथ से बुनी।',
    description_html: '<p>Soft cotton.</p><script>window.hacked = true</script><img src="x" onerror="window.hacked = true">',
    content_blocks: [{ code: 'care', html: '<ul><li>Hand wash</li></ul>' }],
    brand: null,
    unit: 'PCS',
    qty_scale: 1,
    qty_step: 1,
    stock_mode: 'QUANTITY',
    origin: 'Varanasi',
    price: priceOf(4899, 5999),
    stock: stock('IN_STOCK'),
    badges: ['NEW'],
    media: [
        { kind: 'IMAGE', url: 'https://cdn.example/render.jpg', alt: null, tag: 'RENDER', width: 1600, height: 2000, renditions: [], variant_id: null, position: 0 },
        {
            kind: 'IMAGE',
            url: 'https://cdn.example/real.jpg',
            alt: 'Red saree on a table',
            tag: 'REAL',
            width: 1600,
            height: 2000,
            renditions: [320, 640, 960, 1600].map((width) => ({ width, url: `https://cdn.example/real-${width}.webp` })),
            variant_id: null,
            position: 1,
        },
    ],
    options: [
        { code: 'colour', name: 'रंग', kind: 'SWATCH', values: [value('red', 'लाल', 0, '#aa2222'), value('blue', 'नीला', 1, '#223388')] }, // design-lint-ignore: swatch colours are seller data in this fixture
        { code: 'size', name: 'साइज़', kind: 'SIZE', values: [value('s', 'S', 0), value('m', 'M', 1), value('l', 'L', 2)] },
    ],
    // red: S low (2 left), M sold out, no L. blue: M in stock.
    variants: [variant('1', 'red', 's', 'LOW', 0, 2), variant('2', 'red', 'm', 'OUT', 1), variant('3', 'blue', 'm', 'IN_STOCK', 2)],
    specs: [{ code: 'fabric', name: 'कपड़ा', values: ['Cotton'] }],
    collections: [{ slug: 'sarees', kind: 'CATEGORY', name: 'साड़ियाँ', path: '/c/sarees' }],
    seo: { title: 'लाल सूती साड़ी', description: 'हाथ से बुनी।', canonical_path: '/p/red-saree', alternates: [] },
    published_at: null,
    updated_at: null,
};

const card = (id: string, name: string) => ({
    id,
    slug: `saree-${id}`,
    path: `/p/saree-${id}`,
    locale: 'hi',
    name,
    short_description: null,
    brand: null,
    unit: 'PCS',
    qty_scale: 1,
    qty_step: 1,
    origin: null,
    image: null,
    price: priceOf(1250),
    stock: stock('IN_STOCK'),
    badges: [],
    swatches: [],
    variant_count: 1,
    default_variant_id: `v-${id}`,
    published_at: null,
});

const LIST = {
    data: [card('1', 'साड़ी एक'), card('2', 'साड़ी दो')],
    total: 2,
    page: 1,
    page_size: 24,
    has_more: false,
    locale: 'hi',
    facets: {
        attributes: [{ code: 'colour', name: 'रंग', kind: 'TEXT', values: [{ code: 'red', label: 'लाल', swatch_hex: null, count: 1, selected: false }] }],
        price: { min: 1000, max: 2000, bands: [{ from: null, to: 1500, count: 2 }] },
        availability: { in_stock: 2, out_of_stock: 3 },
    },
};

const CART_PRICE = {
    currency: 'INR',
    payment_method: 'PREPAID',
    lines: [{ line_ref: '1', variant_id: '1', sku: 'SAR-1', slug: 'red-saree', name: 'लाल सूती साड़ी', variant_label: 'लाल / S', quantity: 1, qty_scale: 1, qty_step: 1, piece: false, unit: 'PCS', unit_price: 4899, compare_at_price: 5999, gross: 4899, discount: 0, net: 4899 }],
    unavailable: [],
    changes: [],
    discounts: [],
    coupon: null,
    shipping: { basis: 'FLAT', charge: 80, charge_before_free: 80, free: false, free_above: 6000, remaining_for_free: 1101 },
    cod: null,
    tax: { head: 'CGST_SGST', tax_amount: 233.29 },
    totals: { subtotal: 4899, discount: 0, shipping: 80, cod_charge: 0, round_off: 0, total: 4979, line_count: 1 },
};

const requests: Array<{ url: string; method: string; body: unknown }> = [];

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push({ url: url.toString(), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body as string) : null });
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/products/red-saree')) return json(PRODUCT);
        if (url.pathname.endsWith('/products/missing')) return json({ error: { code: 'not_found', message: 'Product not found.' } }, 404);
        if (url.pathname.endsWith('/catalog/v1/products')) return json(LIST);
        if (url.pathname.endsWith('/catalog/v1/categories')) {
            return json({ data: [{ slug: 'sarees', kind: 'CATEGORY', name: 'साड़ियाँ', description: 'हाथ से बुनी साड़ियाँ', image_url: null, path: '/c/sarees', position: 0, product_count: 5, in_stock_count: 2, children: [] }], locale: 'hi' });
        }
        if (url.pathname.endsWith('/cart/price')) return json(CART_PRICE);
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
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={SETTINGS}>
                    {node}
                </CommerceSiteProvider>
            </QueryClientProvider>
        );
    });
};

const settle = async (until: () => boolean, tries = 60) => {
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

beforeEach(() => {
    requests.length = 0;
    router.replace.length = 0;
    router.navigate.length = 0;
    router.location = { pathname: '/p/red-saree', search: '', hash: '', searchStr: '' };
    useCommerceCart.setState({ key: null, cart: EMPTY_CART, hydrated: false, drawerOpen: false, lastAdded: null });
    stubApi();
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('the product page', () => {
    it('shows name, price with the MRP struck through, the tax note, stock and the origin line in Hindi', async () => {
        await render(<ProductTemplate slug="red-saree" sections={BUILT_IN_TEMPLATES.product} />);
        // Loading: a skeleton, never a price of zero.
        expect(text()).not.toContain('₹0');
        await settle(() => !!container.querySelector('h1'));
        expect(container.querySelector('h1')?.textContent).toBe('लाल सूती साड़ी');
        expect(container.querySelector('.cmx-price__now')?.textContent).toBe('₹4,899');
        expect(container.querySelector('.cmx-price__mrp')?.textContent).toContain('₹5,999');
        expect(text()).toContain('18% छूट');
        expect(text()).toContain('सभी कर शामिल');
        expect(text()).toContain('केवल 2 बचे हैं');
        expect(text()).toContain('Varanasi की बुनाई');
        expect(text()).toContain('नया');
        // The API was asked in Hindi (the default) with the publishable key's site.
        expect(requests[0]!.url).toContain('/open/catalog/v1/products/red-saree?locale=hi');
    });

    it('leads the gallery with the lead-tag photo, labels the render, and loads only image 1 eagerly', async () => {
        await render(<ProductTemplate slug="red-saree" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => container.querySelectorAll('.cmx-gallery__track img').length === 2);
        const images = Array.from(container.querySelectorAll<HTMLImageElement>('.cmx-gallery__track img'));
        expect(images[0]!.getAttribute('src')).toBe('https://cdn.example/real-640.webp');
        expect(images[0]!.getAttribute('srcset')).toContain('real-320.webp 320w');
        expect(images[0]!.getAttribute('sizes')).toContain('100vw');
        expect(images[0]!.getAttribute('loading')).toBe('eager');
        expect(images[0]!.getAttribute('width')).toBe('1600');
        expect(images[0]!.getAttribute('alt')).toBe('Red saree on a table');
        expect(images[1]!.getAttribute('loading')).toBe('lazy');
        expect(images[1]!.getAttribute('alt')).toContain('लाल सूती साड़ी');
        expect(container.querySelector('.cmx-media-chip')?.textContent).toBe('Styled render');
        expect(container.querySelector('.cmx-gallery__counter')?.textContent).toBe('1 / 2');
    });

    it('disables a combination that does not exist and strikes through one that is sold out', async () => {
        await render(<ProductTemplate slug="red-saree" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => container.querySelectorAll('[role="radio"]').length === 5);
        const radio = (label: string) =>
            Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => (b.getAttribute('aria-label') || '').startsWith(label));
        // Opens on red / S (the first variant that can be bought).
        expect(radio('लाल')?.getAttribute('aria-checked')).toBe('true');
        expect(radio('S')?.getAttribute('aria-checked')).toBe('true');
        expect(radio('M')?.getAttribute('aria-label')).toBe('M, स्टॉक में नहीं');
        expect(radio('M')?.disabled).toBe(false);
        expect(radio('L')?.disabled).toBe(true);
        expect(radio('L')?.getAttribute('aria-label')).toBe('L, उपलब्ध नहीं');
        // Picking the sold-out size shows "sold out" and disables the buy button.
        await click(radio('M'));
        expect(text()).toContain('स्टॉक में नहीं');
        const buy = container.querySelector<HTMLButtonElement>('.cmx-pdp__info .cmx-btn--primary.cmx-btn--lg');
        expect(buy?.disabled).toBe(true);
        // The address follows the variant.
        expect(router.replace[router.replace.length - 1]).toBe('/p/red-saree?v=SAR-2');
    });

    it('renders seller HTML without scripts or event handlers', async () => {
        await render(<ProductTemplate slug="red-saree" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => !!container.querySelector('.cmx-prose'));
        const html = container.querySelector('.cmx-pdp__info')!.innerHTML;
        expect(html).toContain('Soft cotton.');
        expect(html).toContain('<li>Hand wash</li>');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('onerror');
        expect((window as { hacked?: boolean }).hacked).toBeUndefined();
        // Content blocks are accordions: the first open, with the seller's block after the description.
        const panels = Array.from(container.querySelectorAll('details.cmx-acc'));
        expect(panels.map((p) => p.querySelector('summary')?.textContent)).toEqual(['विवरण', 'देखभाल', 'विशेषताएँ']);
        expect((panels[0] as HTMLDetailsElement).open).toBe(true);
        expect((panels[1] as HTMLDetailsElement).open).toBe(false);
    });

    it('adds to the local cart, opens the drawer and shows the totals the server returned', async () => {
        await render(
            <>
                <ProductTemplate slug="red-saree" sections={BUILT_IN_TEMPLATES.product} />
                <CartDrawer />
            </>
        );
        await settle(() => !!container.querySelector('h1'));
        const buy = container.querySelector<HTMLButtonElement>('.cmx-pdp__info .cmx-btn--primary.cmx-btn--lg');
        expect(buy?.textContent).toBe('कार्ट में डालें');
        await click(buy);
        const state = useCommerceCart.getState();
        expect(state.drawerOpen).toBe(true);
        expect(state.cart.lines).toHaveLength(1);
        expect(state.cart.lines[0]).toMatchObject({ variantId: '1', slug: 'red-saree', quantity: 1, unitPrice: 4899, variantLabel: 'red / s' });
        await settle(() => requests.some((r) => r.url.endsWith('/cart/price')) && text().includes('₹4,979'));
        const priced = requests.find((r) => r.url.endsWith('/cart/price'))!;
        expect(priced.method).toBe('POST');
        expect(priced.body).toMatchObject({ lines: [{ line_ref: '1', variant_id: '1', quantity: 1, unit_price: 4899 }], payment_method: 'PREPAID', locale: 'hi' });
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog.getAttribute('aria-modal') ?? 'true').toBe('true');
        expect(dialog.textContent).toContain('आपका कार्ट');
        expect(dialog.textContent).toContain('आपके कार्ट में जुड़ गया');
        // Delivery, the amount left for free delivery, tax inside the total: all from the server.
        expect(dialog.textContent).toContain('₹80');
        expect(dialog.textContent).toContain('मुफ़्त डिलीवरी के लिए ₹1,101 और जोड़ें');
        expect(dialog.textContent).toContain('₹233.29 कर सहित');
        expect(dialog.textContent).toContain('₹4,979');
        // The drawer is drawn inside the site's theme wrapper, not on document.body.
        expect(container.contains(dialog)).toBe(true);
        // Checkout is not built: the cart offers the order over WhatsApp instead.
        expect(dialog.querySelector('a[href^="https://wa.me/919876543210"]')).toBeTruthy();
        expect(dialog.querySelector('a[href$="/checkout"]')).toBeNull();
    });

    it('says so when the product does not exist', async () => {
        await render(<ProductTemplate slug="missing" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => text().includes('यह उत्पाद उपलब्ध नहीं है'));
        expect(container.querySelector('a.cmx-btn--primary')?.getAttribute('href')).toBe('/shop');
    });

    it('leaves out a section the site switched off', async () => {
        const sections = BUILT_IN_TEMPLATES.product.filter((s) => s !== 'pincode' && s !== 'accordions');
        await render(<ProductTemplate slug="red-saree" sections={sections} />);
        await settle(() => !!container.querySelector('h1'));
        expect(text()).not.toContain('डिलीवरी जाँचें');
        expect(container.querySelector('details.cmx-acc')).toBeNull();
    });
});

describe('the collection page', () => {
    beforeEach(() => {
        router.location = { pathname: '/c/sarees', search: '', hash: '', searchStr: '' };
    });

    it('shows the header from the category tree and the cards of the listing', async () => {
        await render(<CollectionTemplate slug="sarees" sections={BUILT_IN_TEMPLATES.collection} />);
        await settle(() => container.querySelectorAll('.cmx-card').length === 2);
        expect(container.querySelector('h1')?.textContent).toBe('साड़ियाँ');
        expect(text()).toContain('2 उपलब्ध');
        expect(text()).toContain('2 उत्पाद');
        expect(text()).toContain('₹1,250');
        // In stock only by default, with the facets asked for.
        const listing = requests.find((r) => r.url.includes('/catalog/v1/products?'))!;
        const query = new URL(listing.url).searchParams;
        expect(query.get('collection')).toBe('sarees');
        expect(query.get('in_stock')).toBe('true');
        expect(query.get('facets')).toBe('true');
        expect(text()).toContain('3 स्टॉक में नहीं');
        expect(container.querySelector('.cmx-card a')?.getAttribute('href')).toBe('/shop/p/saree-1');
    });

    it('writes a picked filter and the sort into the address', async () => {
        await render(<CollectionTemplate slug="sarees" sections={BUILT_IN_TEMPLATES.collection} />);
        await settle(() => container.querySelectorAll('.cmx-check input').length >= 2);
        const colour = Array.from(container.querySelectorAll<HTMLLabelElement>('.cmx-check')).find((l) => l.textContent?.includes('लाल'));
        await click(colour?.querySelector('input'));
        expect(router.replace[router.replace.length - 1]).toBe('/c/sarees?filter.colour=red');
        const select = container.querySelector<HTMLSelectElement>('select.cmx-select')!;
        await act(async () => {
            select.value = 'price_asc';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(router.replace[router.replace.length - 1]).toBe('/c/sarees?sort=price_asc');
    });

    it('reads the filters of a shared address', async () => {
        router.location = { pathname: '/c/sarees', search: '?filter.colour=red&in_stock=0', hash: '', searchStr: '?filter.colour=red&in_stock=0' };
        await render(<CollectionTemplate slug="sarees" sections={BUILT_IN_TEMPLATES.collection} />);
        await settle(() => requests.some((r) => r.url.includes('/catalog/v1/products?')));
        const query = new URL(requests.find((r) => r.url.includes('/catalog/v1/products?'))!.url).searchParams;
        expect(query.get('filter.colour')).toBe('red');
        expect(query.has('in_stock')).toBe(false);
        // The pill takes its label from the facets once the listing has answered.
        await settle(() => (container.querySelector('.cmx-chip--on')?.textContent || '').includes('लाल'));
        expect(container.querySelector('.cmx-chip--on')?.textContent).toContain('लाल');
    });
});
