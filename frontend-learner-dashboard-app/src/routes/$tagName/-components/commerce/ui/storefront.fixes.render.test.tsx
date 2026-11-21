// @vitest-environment jsdom
/**
 * Rendered checks for the round-4 review fixes: goods sold by length show the price of a
 * metre; the head the edge wrote survives the app's first render and is replaced only when the
 * shopper moves to another page; the font stylesheet is never removed; the product the edge
 * handed over is used without a second request; quick add opens an option sheet; a failed
 * filtered listing can be undone; a shop without COD says nothing about COD.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/shop/p/khadi', search: '', hash: '', searchStr: '' },
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
import { BUILT_IN_TEMPLATES } from '../templates';
import { resetEdgeHead, resetProductSeed } from './Head';
import { CollectionTemplate } from './Listing';
import { ProductTemplate } from './Product';
import { ProductGrid } from './ProductCard';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const SETTINGS = {
    commerce: {
        enabled: true,
        publishableKey: KEY,
        locales: ['hi', 'en'],
        whatsappNumber: '+919876543210',
        theme: { fonts: { display: 'Laila', text: 'Mukta' } },
        reassurance: [{ icon: 'truck', label: 'Ships in 2 working days', text: 'Sent by courier.' }],
    },
};

const stock = (state: string) => ({ state, left: null, purchasable: state !== 'OUT', single_piece: false, lead_time_days: null });
const priceOf = (amount: number) => ({ amount, compare_at_amount: null, currency: 'INR', from: false });

/** Khadi at ₹450 a metre: priced per base unit (1 cm = ₹4.50), 100 base units to the metre. */
const CLOTH = {
    id: 'c1',
    slug: 'khadi',
    path: '/p/khadi',
    locale: 'hi',
    name: 'खादी कपड़ा',
    short_description: null,
    description_html: null,
    content_blocks: [],
    brand: null,
    unit: 'MTR',
    qty_scale: 100,
    qty_step: 10,
    stock_mode: 'QUANTITY',
    origin: null,
    price: priceOf(4.5),
    stock: stock('IN_STOCK'),
    badges: [],
    media: [],
    options: [],
    variants: [{ id: 'cv1', sku: 'FAB-1', label: null, option_values: {}, price: priceOf(4.5), stock: stock('IN_STOCK'), weight_grams: null, length_mm: null, width_mm: null, height_mm: null, image: null, position: 0 }],
    specs: [],
    collections: [{ slug: 'fabric', kind: 'CATEGORY', name: 'कपड़ा', path: '/c/fabric' }],
    seo: { title: 'खादी कपड़ा', description: 'हाथ से काता।', canonical_path: '/p/khadi', alternates: [{ locale: 'en', path: '/p/khadi?lang=en' }] },
    published_at: null,
    updated_at: null,
};

const value = (code: string, label: string, position: number) => ({ code, label, swatch_hex: null, position });
const kurtaVariant = (id: string, size: string, state: string, position: number) => ({
    id,
    sku: `KUR-${size.toUpperCase()}`,
    label: size.toUpperCase(),
    option_values: { size },
    price: priceOf(1800),
    stock: stock(state),
    weight_grams: null,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    image: null,
    position,
});
const KURTA = {
    ...CLOTH,
    id: 'k1',
    slug: 'kurta',
    path: '/p/kurta',
    name: 'खादी कुर्ता',
    unit: 'PCS',
    qty_scale: 1,
    qty_step: 1,
    price: priceOf(1800),
    options: [{ code: 'size', name: 'साइज़', kind: 'SIZE', values: [value('s', 'S', 0), value('m', 'M', 1)] }],
    variants: [kurtaVariant('kv-s', 's', 'OUT', 0), kurtaVariant('kv-m', 'm', 'IN_STOCK', 1)],
    seo: { title: 'खादी कुर्ता', description: null, canonical_path: '/p/kurta', alternates: [] },
};

const card = (product: typeof CLOTH, over: Record<string, unknown> = {}) => ({
    id: product.id,
    slug: product.slug,
    path: product.path,
    locale: 'hi',
    name: product.name,
    short_description: null,
    brand: null,
    unit: product.unit,
    qty_scale: product.qty_scale,
    qty_step: product.qty_step,
    origin: null,
    image: null,
    price: product.price,
    stock: stock('IN_STOCK'),
    badges: [],
    swatches: [],
    variant_count: 1,
    default_variant_id: 'cv1',
    published_at: null,
    ...over,
});

const requests: string[] = [];
let failFiltered = false;
let codReason: string | null = 'COD_DISABLED';

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url.toString());
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/products/khadi')) return json(CLOTH);
        if (url.pathname.endsWith('/products/kurta')) return json(KURTA);
        if (url.pathname.endsWith('/catalog/v1/products')) {
            if (failFiltered && url.searchParams.has('filter.colour')) return json({ error: { code: 'bad_request', message: 'no' } }, 400);
            return json({
                data: [card(CLOTH)],
                total: 1,
                page: 1,
                page_size: 24,
                has_more: false,
                locale: 'hi',
                facets: {
                    attributes: [{ code: 'colour', name: 'रंग', kind: 'TEXT', values: [{ code: 'red', label: 'लाल', swatch_hex: null, count: 1, selected: false }] }],
                    price: null,
                    availability: { in_stock: 1, out_of_stock: 0 },
                },
            });
        }
        if (url.pathname.endsWith('/catalog/v1/categories')) {
            return json({ data: [{ slug: 'fabric', kind: 'CATEGORY', name: 'कपड़ा', description: 'हाथ से काता कपड़ा', image_url: null, path: '/c/fabric', position: 0, product_count: 1, in_stock_count: 1, children: [] }], locale: 'hi' });
        }
        if (url.pathname.includes('/pincode')) {
            return json({ pincode: '482001', city: 'Varanasi', state_code: 'MP', state_name: 'Madhya Pradesh', state_source: 'PINCODE', cod_allowed: false, cod_reason: codReason, dispatch_promise: null });
        }
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

const unmount = async () => {
    await act(async () => root?.unmount());
    root = null;
};

const settle = async (until: () => boolean, tries = 80) => {
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

const goTo = (pathname: string, search = '') => {
    window.history.pushState({}, '', `${pathname}${search}`);
    router.location = { pathname, search, hash: '', searchStr: search };
};

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Laila:wght@400;600&family=Mukta:wght@400;600&display=swap';

/** The document as the edge serves a product page: marked page tags and an unmarked font stylesheet. */
const writeEdgeHead = () => {
    document.head.insertAdjacentHTML(
        'beforeend',
        `<link rel="stylesheet" href="${FONT_HREF.replace(/&/g, '&amp;')}" />` +
            '<link rel="canonical" href="https://shop.example/shop/p/khadi" data-commerce-edge="1" />' +
            '<link rel="alternate" hreflang="en" href="https://shop.example/shop/p/khadi?lang=en" data-commerce-edge="1" />' +
            '<meta property="og:title" content="खादी कपड़ा · ₹450 / मीटर" data-commerce-edge="1" />' +
            '<script type="application/ld+json" data-commerce-edge="1">{"@type":"Product","name":"edge"}</script>'
    );
};

const ldTypes = (selector: string): string[] =>
    Array.from(document.head.querySelectorAll(`script[type="application/ld+json"]${selector}`)).map((node) => JSON.parse(node.textContent || '{}')['@type']);

beforeEach(() => {
    requests.length = 0;
    router.replace.length = 0;
    router.navigate.length = 0;
    failFiltered = false;
    codReason = 'COD_DISABLED';
    goTo('/shop/p/khadi');
    resetEdgeHead();
    resetProductSeed();
    useCommerceCart.setState({ key: null, cart: EMPTY_CART, hydrated: false, drawerOpen: false, lastAdded: null });
    stubApi();
});

afterEach(async () => {
    await unmount();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('goods sold by length', () => {
    it('shows the price of a metre with its unit as the headline price of the product page', async () => {
        await render(<ProductTemplate slug="khadi" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => !!container.querySelector('h1'));
        const headline = container.querySelector('header .cmx-price__now');
        expect(headline?.textContent).toBe('₹450 / मी');
        // Never the price of one base unit.
        expect(text()).not.toContain('₹4.50');
        // The buy button prices the picked length: one metre to start with.
        expect(container.querySelector('.cmx-btn--primary.cmx-btn--block')?.textContent).toBe('कार्ट में डालें · ₹450');
        // The sticky bar shows the amount beside a button that does not repeat it.
        expect(container.querySelector('.cmx-stickybar .cmx-btn')?.textContent).toBe('कार्ट में डालें');
    });

    it('shows the same on a listing card', async () => {
        await render(<ProductGrid products={[card(CLOTH) as never]} />);
        expect(container.querySelector('.cmx-card .cmx-price__now')?.textContent).toBe('₹450 / मी');
        expect(text()).not.toContain('₹4.50');
    });

    it('leaves a product sold by the piece as it was', async () => {
        await render(<ProductGrid products={[card(KURTA as never, { default_variant_id: 'kv-m' }) as never]} />);
        expect(container.querySelector('.cmx-card .cmx-price__now')?.textContent).toBe('₹1,800');
    });
});

describe('the head of a shop page', () => {
    it('keeps what the edge wrote while the landing page is on screen, fonts included', async () => {
        writeEdgeHead();
        await render(<ProductTemplate slug="khadi" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => !!container.querySelector('h1'));
        await settle(() => document.title.includes('खादी कपड़ा'));
        // Structured data, hreflang and the share card are still in the rendered DOM.
        expect(document.head.querySelectorAll('[data-commerce-edge]').length).toBe(4);
        expect(ldTypes('[data-commerce-edge]')).toEqual(['Product']);
        expect(document.head.querySelector('link[rel="alternate"][hreflang="en"]')).toBeTruthy();
        // The app adds no second copy, and exactly one canonical exists.
        expect(document.head.querySelectorAll('[data-commerce-app]').length).toBe(0);
        expect(document.head.querySelectorAll('link[rel="canonical"]').length).toBe(1);
        expect(document.head.querySelector(`link[rel="stylesheet"][href="${FONT_HREF}"]`)).toBeTruthy();
        expect(document.title).toBe('खादी कपड़ा | Example Brand');
    });

    it('replaces the edge tags with the same kind of tags when the shopper opens another product', async () => {
        writeEdgeHead();
        await render(<ProductTemplate slug="khadi" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => !!container.querySelector('h1'));
        await unmount();
        goTo('/shop/p/kurta');
        await render(<ProductTemplate slug="kurta" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => container.querySelector('h1')?.textContent === 'खादी कुर्ता');
        await settle(() => document.head.querySelectorAll('[data-commerce-app]').length > 0);
        // The landing page's tags are gone; the new page has its own Product and BreadcrumbList.
        expect(document.head.querySelectorAll('[data-commerce-edge]').length).toBe(0);
        expect(ldTypes('[data-commerce-app]')).toEqual(['Product', 'BreadcrumbList']);
        const canonical = document.head.querySelectorAll('link[rel="canonical"]');
        expect(canonical.length).toBe(1);
        expect(canonical[0]!.getAttribute('href')).toBe(`${window.location.origin}/shop/p/kurta`);
        expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe('खादी कुर्ता · ₹1,800');
        // The font stylesheet was never the app's to remove.
        expect(document.head.querySelector(`link[rel="stylesheet"][href="${FONT_HREF}"]`)).toBeTruthy();
        await settle(() => document.title === 'खादी कुर्ता | Example Brand');
        // Leaving the page takes its tags along.
        await unmount();
        expect(document.head.querySelectorAll('[data-commerce-app]').length).toBe(0);
    });

    it('writes hreflang and structured data itself when the edge wrote nothing', async () => {
        await render(<ProductTemplate slug="khadi" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => document.head.querySelectorAll('[data-commerce-app]').length > 0);
        expect(ldTypes('[data-commerce-app]')).toEqual(['Product', 'BreadcrumbList']);
        const alternates = Array.from(document.head.querySelectorAll('link[rel="alternate"]')).map((n) => n.getAttribute('hreflang'));
        expect(alternates).toEqual(['hi', 'en', 'x-default']);
        const product = JSON.parse(document.head.querySelector('script[data-commerce-app]')!.textContent || '{}');
        // Per metre, as at the edge.
        expect(product.offers.price).toBe(450);
    });

    it('gives a collection its canonical, BreadcrumbList and ItemList', async () => {
        goTo('/shop/c/fabric', '?filter.size=m');
        await render(<CollectionTemplate slug="fabric" sections={BUILT_IN_TEMPLATES.collection} />);
        await settle(() => ldTypes('[data-commerce-app]').includes('ItemList'));
        expect(ldTypes('[data-commerce-app]')).toEqual(['BreadcrumbList', 'ItemList']);
        // A filtered view points at the bare listing.
        expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${window.location.origin}/shop/c/fabric`);
        await settle(() => document.title === 'कपड़ा | Example Brand');
    });
});

describe('the product the edge handed over', () => {
    const seed = (locale: string) =>
        document.head.insertAdjacentHTML(
            'beforeend',
            `<script type="application/json" id="commerce-seed">${JSON.stringify({ kind: 'product', slug: 'khadi', locale, data: CLOTH }).replace(/</g, '\\u003c')}</script>`
        );

    it('is on screen at the first render, with no request for it', async () => {
        seed('hi');
        await render(<ProductTemplate slug="khadi" sections={BUILT_IN_TEMPLATES.product} />);
        expect(container.querySelector('h1')?.textContent).toBe('खादी कपड़ा');
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 60));
        });
        expect(requests.some((url) => url.includes('/products/khadi'))).toBe(false);
        // Read once and taken out of the document.
        expect(document.getElementById('commerce-seed')).toBeNull();
    });

    it('is ignored when it is in another language than the visitor reads', async () => {
        seed('en');
        await render(<ProductTemplate slug="khadi" sections={BUILT_IN_TEMPLATES.product} />);
        expect(container.querySelector('h1')).toBeNull();
        await settle(() => requests.some((url) => url.includes('/products/khadi?locale=hi')));
    });
});

describe('quick add for a product with options', () => {
    it('opens a sheet with the option picker instead of leaving the listing', async () => {
        await render(<ProductGrid products={[card(KURTA as never, { variant_count: 2, default_variant_id: null }) as never]} />);
        const choose = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'विकल्प चुनें');
        // Nothing is asked for until the sheet opens.
        expect(requests.some((url) => url.includes('/products/kurta'))).toBe(false);
        await click(choose);
        await settle(() => document.querySelectorAll('[role="dialog"] [role="radio"]').length === 2);
        const dialog = document.querySelector('[role="dialog"]')!;
        // The first size that can be bought is picked; the sold-out one says so.
        expect(dialog.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('M');
        expect(dialog.querySelector('[role="radio"][aria-label="S, स्टॉक में नहीं"]')).toBeTruthy();
        await click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'कार्ट में डालें'));
        const { cart, drawerOpen } = useCommerceCart.getState();
        expect(cart.lines.map((l) => [l.variantId, l.quantity, l.variantLabel])).toEqual([['kv-m', 1, 'M']]);
        expect(drawerOpen).toBe(true);
        expect(router.navigate).toEqual([]);
    });
});

describe('a filtered listing that fails', () => {
    it('offers to take the filters off again', async () => {
        failFiltered = true;
        goTo('/shop/c/fabric', '?filter.colour=red');
        await render(<CollectionTemplate slug="fabric" sections={BUILT_IN_TEMPLATES.collection} />);
        await settle(() => !!container.querySelector('[role="alert"]'));
        const clear = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'सब हटाएँ');
        await click(clear);
        expect(router.replace[router.replace.length - 1]).toBe('/shop/c/fabric');
    });
});

describe('the pincode check', () => {
    const check = async () => {
        await render(<ProductTemplate slug="khadi" sections={BUILT_IN_TEMPLATES.product} />);
        await settle(() => !!container.querySelector('input[autocomplete="postal-code"]'));
        const input = container.querySelector<HTMLInputElement>('input[autocomplete="postal-code"]')!;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(input, '482001');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        await settle(() => text().includes('Varanasi'));
    };

    it('says nothing about cash on delivery in a shop that does not offer it', async () => {
        await check();
        expect(text()).not.toContain('कैश ऑन डिलीवरी');
    });

    it('still says when cash on delivery does not reach a pincode', async () => {
        codReason = 'PINCODE_NOT_SERVICEABLE';
        await check();
        expect(text()).toContain('यहाँ कैश ऑन डिलीवरी उपलब्ध नहीं');
    });
});
