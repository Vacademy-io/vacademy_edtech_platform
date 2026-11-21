// @vitest-environment jsdom
/**
 * "You may also like" in the cart (commerce.cart.recommendations): off unless switched on, the
 * listing call each source makes, what is left out (in the cart, sold out), quick add in place
 * (no drawer, the row held where it is), the drawer's row; and the listing's filter column held
 * from the first paint on a desktop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/shop/cart', search: '', hash: '', searchStr: '' },
    navigate: [] as string[],
}));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({
        history: { location: router.location, replace: () => undefined },
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
import { parseCommerceConfig } from '../config';
import type { CartLine } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import { CartDrawer, CartPage } from './Cart';
import { CollectionTemplate } from './Listing';
import { CommerceSiteProvider } from './site';
import { BUILT_IN_TEMPLATES } from '../templates';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const settings = (recommendations?: Record<string, unknown>) => ({
    commerce: { enabled: true, publishableKey: KEY, whatsappNumber: '+919876543210', ...(recommendations ? { cart: { recommendations } } : {}) },
});

const stock = (state: string) => ({ state, left: null, purchasable: state !== 'OUT', single_piece: false, lead_time_days: null });
const card = (id: string, name: string, state = 'IN_STOCK') => ({
    id,
    slug: `item-${id}`,
    path: `/p/item-${id}`,
    locale: 'hi',
    name,
    short_description: null,
    brand: null,
    unit: 'PCS',
    qty_scale: 1,
    qty_step: 1,
    origin: null,
    image: null,
    price: { amount: 450, compare_at_amount: null, currency: 'INR', from: false },
    stock: stock(state),
    badges: [],
    swatches: [],
    variant_count: 1,
    default_variant_id: `v-${id}`,
    published_at: null,
});

const LIST = {
    // item-1 is already in the cart; item-3 is sold out.
    data: [card('1', 'दीया एक'), card('2', 'दीया दो'), card('3', 'दीया तीन', 'OUT'), card('4', 'दीया चार'), card('5', 'दीया पाँच'), card('6', 'दीया छह')],
    total: 6,
    page: 1,
    page_size: 6,
    has_more: false,
    locale: 'hi',
    facets: {
        attributes: [{ code: 'colour', name: 'रंग', kind: 'TEXT', values: [{ code: 'red', label: 'लाल', swatch_hex: null, count: 1, selected: false }] }],
        price: { min: 100, max: 900, bands: [{ from: null, to: 500, count: 4 }] },
        availability: { in_stock: 5, out_of_stock: 1 },
    },
};

const DETAIL = { ...card('1', 'दीया एक'), media: [], options: [], variants: [], specs: [], content_blocks: [], description_html: null, stock_mode: 'QUANTITY', collections: [{ slug: 'lamps', kind: 'CATEGORY', name: 'दीये', path: '/c/lamps' }], seo: null, updated_at: null };

const line = (slug: string, variantId: string): CartLine => ({ variantId, slug, name: slug, variantLabel: null, imageUrl: null, quantity: 1, qtyScale: 1, qtyStep: 1, unit: 'PCS', piece: false, unitPrice: 450, addedAt: 1 });

let tree: unknown[] = [];
let listGate: Promise<void> | null = null;
let listBody: unknown = null;
const requests: string[] = [];

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url.toString());
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/catalog/v1/products')) {
            if (listGate) await listGate;
            return json(listBody ?? LIST);
        }
        if (url.pathname.endsWith('/products/item-1')) return json(DETAIL);
        if (url.pathname.endsWith('/catalog/v1/categories')) return json({ data: tree, locale: 'hi' });
        if (url.pathname.endsWith('/cart/price')) return json({ currency: 'INR', lines: [], unavailable: [], changes: [], totals: null, shipping: null });
        return json({ error: { code: 'not_found' } }, 404);
    });

const listCalls = () => requests.filter((u) => new URL(u).pathname.endsWith('/catalog/v1/products')).map((u) => new URL(u).searchParams);

let root: Root | null = null;
let container: HTMLDivElement;

const render = async (node: React.ReactNode, globalSettings: unknown) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
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

const recCards = () => Array.from(document.querySelectorAll('.cmx-recs ul:not([aria-hidden]) .cmx-card'));
const recNames = () => recCards().map((c) => c.querySelector('.cmx-card__name')!.textContent);

beforeEach(() => {
    requests.length = 0;
    router.navigate.length = 0;
    tree = [{ slug: 'bestsellers', kind: 'COLLECTION', name: 'सबसे ज़्यादा बिके', description: null, image_url: null, path: '/c/bestsellers', position: 0, product_count: 6, in_stock_count: 5, children: [] }];
    listGate = null;
    listBody = null;
    window.localStorage.clear();
    useCommerceCart.setState({
        key: 'commerce-cart:inst-1:shop',
        hydrated: true,
        drawerOpen: false,
        lastAdded: null,
        cart: { version: 1, pincode: null, lines: [line('item-1', 'v-1')] },
    });
    stubApi();
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the setting', () => {
    it('is off by default and reads source, maxPrice, limit and title', () => {
        expect(parseCommerceConfig(settings()).cartRecommendations).toBeNull();
        expect(parseCommerceConfig(settings({ enabled: false, source: 'bestsellers' })).cartRecommendations).toBeNull();
        expect(parseCommerceConfig(settings({ enabled: true })).cartRecommendations).toEqual({ source: { kind: 'bestsellers' }, maxPrice: null, limit: 4, title: '' });
        expect(parseCommerceConfig(settings({ enabled: true, source: 'collection:Gifts-Under-999', limit: 8, title: 'साथ में लें' })).cartRecommendations).toEqual({
            source: { kind: 'collection', slug: 'gifts-under-999' },
            maxPrice: null,
            limit: 8,
            title: 'साथ में लें',
        });
        expect(parseCommerceConfig(settings({ enabled: true, source: 'same-category', maxPrice: 1500 })).cartRecommendations?.source).toEqual({ kind: 'same-category' });
        expect(parseCommerceConfig(settings({ enabled: true, source: 'under-price', maxPrice: '999' })).cartRecommendations).toMatchObject({ source: { kind: 'under-price' }, maxPrice: 999 });
        // Under a price with no price, a bad slug, a bad limit: the safe reading.
        expect(parseCommerceConfig(settings({ enabled: true, source: 'under-price' })).cartRecommendations?.source).toEqual({ kind: 'bestsellers' });
        expect(parseCommerceConfig(settings({ enabled: true, source: 'collection:../x' })).cartRecommendations?.source).toEqual({ kind: 'bestsellers' });
        expect(parseCommerceConfig(settings({ enabled: true, limit: 50 })).cartRecommendations?.limit).toBe(4);
    });

    it('shows nothing and asks nothing on a shop that has not switched it on', async () => {
        await render(<CartPage />, settings());
        await settle(() => requests.some((u) => u.includes('/cart/price')));
        expect(document.querySelector('.cmx-recs')).toBeNull();
        expect(listCalls()).toHaveLength(0);
    });
});

describe('the cart page row', () => {
    it('bestsellers: asks the hand-kept collection, in stock, with spare cards; leaves out the cart and sold-out items', async () => {
        await render(<CartPage />, settings({ enabled: true, source: 'bestsellers', limit: 4 }));
        await settle(() => recCards().length > 0);
        const params = listCalls()[0]!;
        expect(params.get('collection')).toBe('bestsellers');
        expect(params.get('in_stock')).toBe('true');
        expect(params.get('page_size')).toBe('5');
        expect(params.has('sort')).toBe(false);
        expect(document.querySelector('.cmx-recs h2')!.textContent).toBe('आपको ये भी पसंद आ सकते हैं');
        expect(recNames()).toEqual(['दीया दो', 'दीया चार', 'दीया पाँच', 'दीया छह']);
    });

    it('bestsellers without such a collection: the shop in its recommended order', async () => {
        tree = [];
        await render(<CartPage />, settings({ enabled: true }));
        await settle(() => recCards().length > 0);
        expect(listCalls()[0]!.has('collection')).toBe(false);
    });

    it('collection:<slug>, under-price and the title from the setting', async () => {
        await render(<CartPage />, settings({ enabled: true, source: 'collection:gifts', title: 'साथ में लें' }));
        await settle(() => recCards().length > 0);
        expect(listCalls()[0]!.get('collection')).toBe('gifts');
        expect(document.querySelector('.cmx-recs h2')!.textContent).toBe('साथ में लें');
        await act(async () => root?.unmount());
        requests.length = 0;
        await render(<CartPage />, settings({ enabled: true, source: 'under-price', maxPrice: 999, limit: 2 }));
        await settle(() => recCards().length > 0);
        expect(listCalls()[0]!.get('price_max')).toBe('999');
        expect(listCalls()[0]!.has('collection')).toBe(false);
        expect(recCards()).toHaveLength(2);
    });

    it('same-category: the category of the product added last', async () => {
        await render(<CartPage />, settings({ enabled: true, source: 'same-category' }));
        await settle(() => recCards().length > 0);
        expect(requests.some((u) => new URL(u).pathname.endsWith('/products/item-1'))).toBe(true);
        expect(listCalls()[0]!.get('collection')).toBe('lamps');
    });

    it('quick add puts the product in the cart in place: no drawer, the card stays and says so', async () => {
        await render(<CartPage />, settings({ enabled: true }));
        await settle(() => recCards().length === 4);
        const button = recCards()[0]!.querySelector<HTMLButtonElement>('.cmx-card__quick button')!;
        expect(button.textContent).toBe('कार्ट में डालें');
        await act(async () => button.click());
        const state = useCommerceCart.getState();
        expect(state.cart.lines.map((l) => l.slug).sort()).toEqual(['item-1', 'item-2']);
        expect(state.drawerOpen).toBe(false);
        // Still in the row (nothing slides sideways), now marked as in the cart.
        expect(recNames()).toEqual(['दीया दो', 'दीया चार', 'दीया पाँच', 'दीया छह']);
        expect(recCards()[0]!.querySelector('.cmx-card__quick button')!.textContent).toBe('कार्ट में है');
        expect(recCards()[0]!.querySelector('.cmx-card__quick button')!.getAttribute('aria-label')).toBe('दीया दो कार्ट में है, एक और डालें');
        expect(document.querySelector('.cmx-recs [role="status"]')!.textContent).toBe('दीया दो कार्ट में जोड़ दिया');
        // The new line is in the cart list above.
        expect(document.querySelectorAll('.cmx-line')).toHaveLength(2);
    });

    it('holds the row where it was on screen when the cart above it grows', async () => {
        await render(<CartPage />, settings({ enabled: true }));
        await settle(() => recCards().length === 4);
        // A layout stand-in: the row sits 120px lower for every cart line above it.
        const rect = (top: number) => ({ top, bottom: top + 300, left: 0, right: 0, width: 0, height: 300, x: 0, y: top, toJSON: () => ({}) });
        const original = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            if (this.classList.contains('cmx-recs')) return rect(400 + 120 * document.querySelectorAll('.cmx-line').length - scrolled) as DOMRect;
            return original.call(this);
        });
        let scrolled = 0;
        const scrollBy = vi.fn((_x: number, y: number) => {
            scrolled += y;
        });
        vi.stubGlobal('scrollBy', scrollBy);
        await act(async () => recCards()[0]!.querySelector<HTMLButtonElement>('.cmx-card__quick button')!.click());
        expect(scrollBy).toHaveBeenCalledWith(0, 120);
        // Back where it was before the add (520), not 120px lower.
        expect(document.querySelector('.cmx-recs')!.getBoundingClientRect().top).toBe(520);
        // No second listing call: the row did not reload.
        expect(listCalls()).toHaveLength(1);
    });

    it('is not shown under an empty cart (that page has its own new-arrivals row)', async () => {
        useCommerceCart.setState({ cart: { version: 1, pincode: null, lines: [] } });
        await render(<CartPage />, settings({ enabled: true }));
        await settle(() => listCalls().length === 1);
        expect(document.querySelector('.cmx-recs')).toBeNull();
        // The one listing call is the empty cart's own row (newest).
        expect(listCalls()[0]!.get('sort')).toBe('newest');
    });
});

describe('the drawer row', () => {
    it('shows under the lines, adds without leaving the drawer, and closes the drawer when a product is opened', async () => {
        useCommerceCart.setState({ drawerOpen: true });
        await render(<CartDrawer />, settings({ enabled: true, limit: 3 }));
        await settle(() => recCards().length === 3);
        expect(document.querySelector('.cmx-recs--drawer h2')!.textContent).toBe('आपको ये भी पसंद आ सकते हैं');
        await act(async () => recCards()[1]!.querySelector<HTMLButtonElement>('.cmx-card__quick button')!.click());
        expect(useCommerceCart.getState().cart.lines).toHaveLength(2);
        expect(useCommerceCart.getState().drawerOpen).toBe(true);
        await act(async () => recCards()[0]!.querySelector<HTMLAnchorElement>('.cmx-card__link')!.click());
        expect(useCommerceCart.getState().drawerOpen).toBe(false);
    });

    it('a product card elsewhere still opens the drawer after quick add', async () => {
        const { ProductRail } = await import('./ProductCard');
        await render(<ProductRail products={[card('9', 'दीया नौ')] as never} />, settings({ enabled: true }));
        await act(async () => document.querySelector<HTMLButtonElement>('.cmx-card__quick button')!.click());
        expect(useCommerceCart.getState().drawerOpen).toBe(true);
        expect(document.querySelector('.cmx-card__quick button')!.textContent).toBe('कार्ट में डालें');
    });
});

describe('the listing filter column on a desktop', () => {
    const FILTERS_FLAG = 'commerce-filters:inst-1:shop';
    const gated = () => {
        let open: () => void = () => undefined;
        listGate = new Promise<void>((resolve) => {
            open = resolve;
        });
        return () => open();
    };
    const listing = () => document.querySelector('.cmx-listing')!;
    const showCategory = async () => {
        router.location = { pathname: '/shop/c/lamps', search: '', hash: '', searchStr: '' };
        await render(<CollectionTemplate slug="lamps" sections={BUILT_IN_TEMPLATES.collection} />, settings());
    };

    it('a shop known to have filters: held from the first paint (skeleton), then the filters; the grid never changes width', async () => {
        window.localStorage.setItem(FILTERS_FLAG, '1');
        const open = gated();
        await showCategory();
        expect(listing().classList.contains('cmx-listing--sidebar')).toBe(true);
        expect(listing().querySelector('aside')!.getAttribute('aria-busy')).toBe('true');
        expect(listing().querySelector('aside h2')!.textContent).toBe('फ़िल्टर');
        expect(listing().querySelector('ul.cmx-grid')!.classList.contains('cmx-grid--with-sidebar')).toBe(true);
        await act(async () => open());
        await settle(() => !!listing().querySelector('aside input[type="checkbox"]'));
        expect(listing().classList.contains('cmx-listing--sidebar')).toBe(true);
        expect(listing().querySelector('aside')!.hasAttribute('aria-busy')).toBe(false);
        expect(listing().querySelector('ul.cmx-grid')!.classList.contains('cmx-grid--with-sidebar')).toBe(true);
        // The phone's Filter button is still in the toolbar; the stylesheet hides it beside the column.
        expect(listing().querySelector('.cmx-toolbar__filter')).toBeTruthy();
        expect(window.localStorage.getItem(FILTERS_FLAG)).toBe('1');
    });

    it('a shop without filters (no price bands, no filterable attribute): no column, ever, and it is remembered', async () => {
        listBody = { ...LIST, facets: { attributes: [], price: { min: 100, max: 900, bands: [] }, availability: { in_stock: 5, out_of_stock: 1 } } };
        const open = gated();
        await showCategory();
        // Not known yet on this device: no column while it loads.
        expect(listing().classList.contains('cmx-listing--sidebar')).toBe(false);
        expect(listing().querySelector('aside')).toBeNull();
        expect(listing().querySelector('ul.cmx-grid')!.classList.contains('cmx-grid--with-sidebar')).toBe(false);
        await act(async () => open());
        await settle(() => listing().querySelectorAll('ul.cmx-grid .cmx-card__name').length > 0);
        expect(listing().classList.contains('cmx-listing--sidebar')).toBe(false);
        expect(listing().querySelector('aside')).toBeNull();
        expect(window.localStorage.getItem(FILTERS_FLAG)).toBe('0');
        // The next listing on this device still holds none.
        await act(async () => root?.unmount());
        gated();
        await showCategory();
        expect(listing().querySelector('aside')).toBeNull();
        expect(listing().classList.contains('cmx-listing--sidebar')).toBe(false);
    });

    it('templates.collection.filterColumn says it outright: true holds from the very first visit, false never', async () => {
        const site = (filterColumn: boolean) => ({ commerce: { ...settings().commerce, templates: { collection: { filterColumn } } } });
        gated();
        router.location = { pathname: '/shop/c/lamps', search: '', hash: '', searchStr: '' };
        await render(<CollectionTemplate slug="lamps" sections={BUILT_IN_TEMPLATES.collection} />, site(true));
        expect(listing().querySelector('aside')!.getAttribute('aria-busy')).toBe('true');
        await act(async () => root?.unmount());
        window.localStorage.setItem(FILTERS_FLAG, '1');
        gated();
        await render(<CollectionTemplate slug="lamps" sections={BUILT_IN_TEMPLATES.collection} />, site(false));
        expect(listing().querySelector('aside')).toBeNull();
    });

    it('a shop with filters seen for the first time: the column comes with the answer, and is held from then on', async () => {
        const open = gated();
        await showCategory();
        expect(listing().querySelector('aside')).toBeNull();
        await act(async () => open());
        await settle(() => !!listing().querySelector('aside input[type="checkbox"]'));
        expect(window.localStorage.getItem(FILTERS_FLAG)).toBe('1');
        await act(async () => root?.unmount());
        gated();
        await showCategory();
        expect(listing().querySelector('aside')!.getAttribute('aria-busy')).toBe('true');
    });
});
