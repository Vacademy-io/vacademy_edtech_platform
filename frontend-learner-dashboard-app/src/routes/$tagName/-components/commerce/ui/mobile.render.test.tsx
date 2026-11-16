// @vitest-environment jsdom
/**
 * The phone storefront switches: the category bar in the site header (commerce.categoryBar),
 * the header fold, one bar only, the pinned Filter·Sort row, the product page's buy area before
 * its long text, the shop-all grid block, the announcement strip and the floating button. Each
 * is checked both switched on and, where it has a switch, switched off (today's markup).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/c/sarees', search: '', hash: '', searchStr: '' },
    replace: [] as string[],
}));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({
        history: { location: router.location, replace: (href: string) => void router.replace.push(href) },
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
import { isCategoryBarOn, isCategoryBarOnFor } from '../lazy';
import { CategoryBar, CategoryHeaderRow } from './Chrome';
import { AnnouncementBar, WhatsAppButton } from './ContentSections';
import { CollectionTemplate } from './Listing';
import { ProductTemplate } from './Product';
import { CommerceSectionView } from './Sections';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const BAR = { enabled: true, pages: ['home', 'shop', 'collection', 'search', 'product'], style: 'chips', items: 'auto', showAll: true, collapseHeaderOnScroll: true };
const settings = (extra: Record<string, unknown> = {}) => ({ commerce: { enabled: true, publishableKey: KEY, whatsappNumber: '+919876543210', ...extra } });

const stock = { state: 'IN_STOCK', left: null, purchasable: true, single_piece: false, lead_time_days: null };
const price = { amount: 3149, compare_at_amount: null, currency: 'INR', from: false };
const LONG = 'उत्पाद : सूती साड़ी शिल्प – हथकरघा निर्मित सामग्री : 100% सूती धागे साइज़ : 6.3 मीटर बुनाई : डॉबी-बूटी रंग : लाल धुलाई : पहली बार ठंडे पानी में अलग से';
const PRODUCT = {
    id: 'p1', slug: 'red-saree', path: '/p/red-saree', locale: 'hi', name: 'लाल साड़ी', short_description: LONG,
    description_html: null, content_blocks: [], brand: null, unit: 'PCS', qty_scale: 1, qty_step: 1, stock_mode: 'QUANTITY', origin: null,
    price, stock, badges: [], media: [], options: [],
    variants: [{ id: 'v1', sku: 'S-1', label: null, option_values: {}, price, stock, weight_grams: null, length_mm: null, width_mm: null, height_mm: null, image: null, position: 0 }],
    specs: [], collections: [{ slug: 'silk-sarees', kind: 'CATEGORY', name: 'रेशमी साड़ियाँ', path: '/c/silk-sarees' }],
    seo: { title: 'लाल साड़ी', description: null, canonical_path: '/p/red-saree', alternates: [] }, published_at: null, updated_at: null,
};
const cat = (slug: string, name: string, children: unknown[] = []) => ({
    slug, kind: 'CATEGORY', name, description: null, image_url: null, path: `/c/${slug}`, position: 0, product_count: 9, in_stock_count: 9, children,
});
const TREE = [cat('sarees', 'साड़ियाँ', [cat('silk-sarees', 'रेशमी साड़ियाँ')]), cat('bags', 'बैग')];
const card = (id: string) => ({
    id, slug: `s-${id}`, path: `/p/s-${id}`, locale: 'hi', name: `साड़ी ${id}`, short_description: null, brand: null, unit: 'PCS', qty_scale: 1, qty_step: 1,
    origin: null, image: null, price, stock, badges: [], swatches: [], variant_count: 1, default_variant_id: `v-${id}`, published_at: null,
});
const LIST = {
    data: [card('1'), card('2')], total: 2, page: 1, page_size: 24, has_more: false, locale: 'hi',
    facets: { attributes: [], price: { min: 1000, max: 4000, bands: [{ from: null, to: 1500, count: 1 }] }, availability: { in_stock: 2, out_of_stock: 0 } },
};

const requests: string[] = [];
const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url.toString());
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/products/red-saree')) return json(PRODUCT);
        if (url.pathname.endsWith('/catalog/v1/products')) return json(LIST);
        if (url.pathname.endsWith('/catalog/v1/categories')) return json({ data: TREE, locale: 'hi' });
        return json({ error: { code: 'not_found' } }, 404);
    });

let root: Root | null = null;
let container: HTMLDivElement;
const render = async (node: React.ReactNode, globalSettings: unknown) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    container.setAttribute('data-catalogue-theme', 'default');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={globalSettings}>
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
const at = (pathname: string) => {
    router.location = { pathname, search: '', hash: '', searchStr: '' };
};
const chips = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('nav.cmx-hbar .cmx-hbar__chip'));

beforeEach(() => {
    requests.length = 0;
    at('/shop/c/sarees');
    useCommerceCart.setState({ key: null, cart: EMPTY_CART, hydrated: false, drawerOpen: false, lastAdded: null });
    stubApi();
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    document.documentElement.style.removeProperty('--cmx-pin-top');
    vi.unstubAllGlobals();
});

describe('the category bar switch (lazy.tsx: what the header and the page offset ask)', () => {
    it('is on only for the listed pages of a site that turned it on', () => {
        const on = settings({ categoryBar: BAR });
        expect(isCategoryBarOn(on, 'shop', '/shop/c/sarees')).toBe(true);
        expect(isCategoryBarOn(on, 'shop', '/shop')).toBe(true);
        expect(isCategoryBarOn(on, 'shop', '/shop/shop')).toBe(true);
        expect(isCategoryBarOn(on, 'shop', '/shop/p/red-saree')).toBe(true);
        expect(isCategoryBarOn(on, 'shop', '/shop/cart')).toBe(false);
        expect(isCategoryBarOn(on, 'shop', '/shop/checkout')).toBe(false);
        expect(isCategoryBarOn(on, 'shop', '/shop/our-story')).toBe(false);
        expect(isCategoryBarOnFor(on, 'homepage')).toBe(true);
        expect(isCategoryBarOnFor(on, 'product')).toBe(true);
        expect(isCategoryBarOnFor(on, 'policies')).toBe(false);
    });

    it('is off on a shop without the setting and on a site without a shop', () => {
        expect(isCategoryBarOn(settings(), 'shop', '/shop/c/sarees')).toBe(false);
        expect(isCategoryBarOn({}, 'shop', '/shop')).toBe(false);
        expect(isCategoryBarOn(undefined, 'shop', '/shop')).toBe(false);
        expect(isCategoryBarOnFor({ layout: {} }, 'homepage')).toBe(false);
    });
});

describe('the category bar row in the header', () => {
    it('draws nothing on a shop without the setting', async () => {
        await render(<CategoryHeaderRow />, settings());
        expect(container.innerHTML).toBe('');
    });

    it('shows All and the categories as 44px chips, the current collection filled, its second level for a desktop', async () => {
        await render(<CategoryHeaderRow />, settings({ categoryBar: BAR }));
        await settle(() => chips().length === 3);
        expect(chips().map((a) => a.textContent)).toEqual(['सब', 'साड़ियाँ', 'बैग']);
        const current = container.querySelectorAll('nav.cmx-hbar [aria-current]');
        expect(current).toHaveLength(1);
        expect(current[0]!.getAttribute('aria-current')).toBe('page');
        expect(current[0]!.textContent).toBe('साड़ियाँ');
        expect(container.querySelector('nav.cmx-hbar')?.classList.contains('cmx-hbar--chips')).toBe(true);
        expect(Array.from(container.querySelectorAll('.cmx-catbar__menu a')).map((a) => a.textContent)).toEqual(['रेशमी साड़ियाँ']);
    });

    it("marks the parent of a child collection, All on the shop page, and outlines a product's category", async () => {
        at('/shop/c/silk-sarees');
        await render(<CategoryHeaderRow />, settings({ categoryBar: BAR }));
        await settle(() => !!container.querySelector('[aria-current="page"]'));
        expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('साड़ियाँ');
        await act(async () => root?.unmount());

        at('/shop/shop'); // the site's "shop" page on a host where the site's tag is "shop"
        await render(<CategoryHeaderRow />, settings({ categoryBar: BAR }));
        await settle(() => !!container.querySelector('[aria-current="page"]'));
        expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('सब');
        await act(async () => root?.unmount());

        at('/shop/p/red-saree');
        await render(<CategoryHeaderRow />, settings({ categoryBar: BAR }));
        await settle(() => !!container.querySelector('[aria-current="true"]'));
        expect(container.querySelector('[aria-current="true"]')?.textContent).toBe('साड़ियाँ');
        expect(container.querySelector('[aria-current="page"]')).toBeNull();
    });

    it('holds its 48px row with skeleton chips while the categories load', async () => {
        vi.stubGlobal('fetch', () => new Promise(() => undefined));
        await render(<CategoryHeaderRow />, settings({ categoryBar: BAR }));
        expect(container.querySelectorAll('.cmx-hbar__skel')).toHaveLength(5);
        expect(container.querySelector('nav.cmx-hbar')).not.toBeNull();
    });

    it('folds the logo row on scroll-down, brings it back on scroll-up and for the menu, and cleans up', async () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
            fn(0);
            return 0;
        });
        Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
        const scrollTo = async (y: number) => {
            Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
            await act(async () => {
                window.dispatchEvent(new Event('scroll'));
            });
        };
        const Header: React.FC<{ menuOpen: boolean }> = ({ menuOpen }) => (
            <header>
                <div>logo row</div>
                <CategoryHeaderRow menuOpen={menuOpen} />
            </header>
        );
        await render(<Header menuOpen={false} />, settings({ categoryBar: BAR }));
        const header = container.querySelector('header')!;
        expect(header.hasAttribute('data-cmx-bar')).toBe(true);
        expect(document.documentElement.style.getPropertyValue('--cmx-pin-top')).not.toBe('');
        await scrollTo(100);
        expect(header.hasAttribute('data-cmx-folded')).toBe(false); // under 160px: never
        await scrollTo(400);
        expect(header.hasAttribute('data-cmx-folded')).toBe(true);
        await scrollTo(390); // 10px up: not yet
        expect(header.hasAttribute('data-cmx-folded')).toBe(true);
        await scrollTo(360); // 40px up from the turn
        expect(header.hasAttribute('data-cmx-folded')).toBe(false);
        await scrollTo(800);
        expect(header.hasAttribute('data-cmx-folded')).toBe(true);
        await act(async () => {
            root!.render(
                <QueryClientProvider client={new QueryClient()}>
                    <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={settings({ categoryBar: BAR })}>
                        <Header menuOpen />
                    </CommerceSiteProvider>
                </QueryClientProvider>
            );
        });
        expect(header.hasAttribute('data-cmx-folded')).toBe(false);
        await act(async () => root?.unmount());
        root = null;
        expect(header.hasAttribute('data-cmx-bar')).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--cmx-pin-top')).toBe('');
        Reflect.deleteProperty(document.documentElement, 'scrollHeight');
    });

    it('never folds when the site keeps the logo row (collapseHeaderOnScroll off)', async () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        await render(
            <header>
                <CategoryHeaderRow />
            </header>,
            settings({ categoryBar: { ...BAR, collapseHeaderOnScroll: false } })
        );
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 900 });
        await act(async () => {
            window.dispatchEvent(new Event('scroll'));
            await new Promise((resolve) => setTimeout(resolve, 40));
        });
        expect(container.querySelector('header')!.hasAttribute('data-cmx-folded')).toBe(false);
    });
});

describe('the in-page category bar (sites without the header bar keep it)', () => {
    it('still renders as today when called', async () => {
        await render(<CategoryBar current="sarees" />, settings());
        await settle(() => container.querySelectorAll('nav.cmx-catbar .cmx-catbar__link').length === 2);
        expect(container.querySelector('nav.cmx-catbar [aria-current="page"]')?.textContent).toBe('साड़ियाँ');
    });
});

describe('the product page on a phone', () => {
    const order = () => {
        const info = container.querySelector('.cmx-pdp__info')!;
        const all = Array.from(info.querySelectorAll('*'));
        return {
            price: all.indexOf(info.querySelector('.cmx-price')!),
            button: all.indexOf(info.querySelector('.cmx-btn--primary')!),
            text: all.findIndex((el) => el.tagName === 'P' && el.textContent === LONG),
        };
    };

    it('puts the price and the button before the long short description, which is clamped with Read more', async () => {
        at('/p/red-saree');
        await render(<ProductTemplate slug="red-saree" sections={BUILT_IN_TEMPLATES.product} />, settings());
        await settle(() => !!container.querySelector('h1'));
        const { price: p, button, text } = order();
        expect(p).toBeGreaterThan(-1);
        expect(button).toBeGreaterThan(p);
        expect(text).toBeGreaterThan(button);
        const description = container.querySelector('.cmx-pdp__summary p')!;
        expect(description.classList.contains('cmx-clamp--2')).toBe(true);
        const more = container.querySelector<HTMLButtonElement>('.cmx-pdp__summary button')!;
        expect(more.textContent).toBe('और पढ़ें');
        await act(async () => more.click());
        expect(description.classList.contains('cmx-clamp--2')).toBe(false);
        expect(more.getAttribute('aria-expanded')).toBe('true');
        // Without the header bar: today's back link and layout.
        expect(container.querySelector('.cmx-pdp--compact')).toBeNull();
        const back = Array.from(container.querySelectorAll('.cmx-pdp__info a')).find((a) => a.textContent?.includes('रेशमी साड़ियाँ'));
        expect(back?.className).toContain('inline-flex');
        expect(back?.className).not.toContain('hidden');
    });

    it('with the header bar: the compact layout, and the back link left to the bar below a desktop', async () => {
        at('/p/red-saree');
        await render(<ProductTemplate slug="red-saree" sections={BUILT_IN_TEMPLATES.product} categoryBar />, settings({ categoryBar: BAR }));
        await settle(() => !!container.querySelector('h1'));
        expect(container.querySelector('.cmx-pdp--compact')).not.toBeNull();
        const back = Array.from(container.querySelectorAll('.cmx-pdp__info a')).find((a) => a.textContent?.includes('रेशमी साड़ियाँ'));
        expect(back?.className).toContain('hidden lg:inline-flex');
    });
});

describe('the Filter·Sort row', () => {
    it('is pinned and says the count once only when templates.collection.stickyToolbar is on', async () => {
        await render(<CollectionTemplate slug="sarees" sections={BUILT_IN_TEMPLATES.collection} />, settings({ templates: { collection: { stickyToolbar: true } } }));
        await settle(() => container.querySelectorAll('.cmx-card').length === 2);
        const toolbar = container.querySelector('.cmx-toolbar')!;
        expect(toolbar.classList.contains('cmx-toolbar--sticky')).toBe(true);
        expect(toolbar.classList.contains('cmx-toolbar--nocount')).toBe(true);
        // Still a live region for screen readers.
        expect(toolbar.querySelector('[role="status"]')?.textContent).toBe('2 उत्पाद');
        expect(toolbar.querySelector('.cmx-toolbar__filter')).not.toBeNull();
        expect(toolbar.querySelector('.cmx-toolbar__sort select')).not.toBeNull();
    });

    it("keeps today's toolbar without the switch", async () => {
        await render(<CollectionTemplate slug="sarees" sections={BUILT_IN_TEMPLATES.collection} />, settings());
        await settle(() => container.querySelectorAll('.cmx-card').length === 2);
        const toolbar = container.querySelector('.cmx-toolbar')!;
        expect(toolbar.className).toBe('cmx-toolbar');
    });
});

describe('the shop-all grid block (commerceProductGrid)', () => {
    it('lists every product with its count, Filter·Sort and the listing paging', async () => {
        at('/shop');
        await render(<CommerceSectionView type="commerceProductGrid" props={{ title: 'सारे उत्पाद' }} />, settings());
        await settle(() => container.querySelectorAll('.cmx-card').length === 2);
        expect(container.querySelector('h2')?.textContent).toBe('सारे उत्पाद');
        expect(container.textContent).toContain('2 उत्पाद');
        expect(container.querySelector('.cmx-toolbar select')).not.toBeNull();
        const listing = requests.find((url) => url.includes('/catalog/v1/products?'))!;
        expect(listing).not.toContain('collection=');
        expect(listing).toContain('facets=true');
    });

    it('can be scoped to one collection, and falls back to its default title', async () => {
        await render(<CommerceSectionView type="commerceProductGrid" props={{ collection: 'sarees' }} />, settings());
        await settle(() => container.querySelectorAll('.cmx-card').length === 2);
        expect(container.querySelector('h2')?.textContent).toBe('सारे उत्पाद');
        expect(requests.find((url) => url.includes('/catalog/v1/products?'))).toContain('collection=sarees');
    });
});

describe('the announcement strip and the floating button', () => {
    it('makes the whole strip the link, one line of fixed height', async () => {
        await render(<AnnouncementBar props={{ text: '₹80 डिलीवरी', route: 'policies' }} />, settings());
        const link = container.querySelector('a.cmx-announce__in');
        expect(link).not.toBeNull();
        expect(link?.querySelector('.cmx-announce__text')?.textContent).toBe('₹80 डिलीवरी');
        await act(async () => root?.unmount());
        await render(<AnnouncementBar props={{ text: 'केवल पाठ' }} />, settings());
        expect(container.querySelector('a')).toBeNull();
        expect(container.querySelector('p.cmx-announce__in .cmx-announce__text')?.textContent).toBe('केवल पाठ');
    });

    it('shows the floating WhatsApp button when nothing is under it', async () => {
        await render(<WhatsAppButton props={{}} />, settings());
        const fab = container.querySelector('a.cmx-fab')!;
        expect(fab.getAttribute('href')).toContain('wa.me');
        expect(fab.classList.contains('cmx-fab--away')).toBe(false);
    });

    it('steps aside while a button is under it', async () => {
        const button = document.createElement('button');
        document.body.appendChild(button);
        Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [button] });
        await render(<WhatsAppButton props={{}} />, settings());
        expect(container.querySelector('a.cmx-fab')!.classList.contains('cmx-fab--away')).toBe(true);
        Reflect.deleteProperty(document, 'elementsFromPoint');
    });
});
