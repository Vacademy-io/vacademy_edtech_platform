// @vitest-environment jsdom
/**
 * The category bar's "image" style (commerce.categoryBar.style = "image"): the photo row at the
 * top of the page and its fold into the chip row on scroll. Also the follow-ups of the mobile
 * round: the pinned Filter·Sort row follows the header fold with a transform, every shop header
 * says where it ends (--cmx-head-bottom), a desktop row with more chips than it holds scrolls
 * without its hover menus, the announcement strip keeps two lines, and commerceSteps photos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/shop/c/sarees', search: '', hash: '', searchStr: '' },
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

import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EMPTY_CART } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import { categoryBarOffsetAt, categoryBarOffsetFor } from '../lazy';
import { CategoryHeaderRow, HeaderSlot } from './Chrome';
import { AnnouncementBar } from './ContentSections';
import { CommerceSectionView } from './Sections';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const PHOTO_BAR = { enabled: true, pages: ['home', 'shop', 'collection', 'search', 'product'], style: 'image', items: 'auto', showAll: true, collapseHeaderOnScroll: true };
const settings = (extra: Record<string, unknown> = {}) => ({ commerce: { enabled: true, publishableKey: KEY, whatsappNumber: '+919876543210', ...extra } });

const cat = (slug: string, name: string, image: string | null) => ({
    slug, kind: 'CATEGORY', name, description: null, image_url: image, path: `/c/${slug}`, position: 0, product_count: 9, in_stock_count: 9, children: [],
});
const TREE = [
    cat('sarees', 'साड़ियाँ', 'https://media.example/c-sarees.webp'),
    cat('bags', 'बैग', null),
    cat('towels', 'तौलिया', 'https://media.example/c-towels.webp'),
    cat('fabric', 'कपड़ा', 'https://media.example/c-fabric.webp'),
    cat('lamps', 'दीये', 'https://media.example/c-lamps.webp'),
    cat('pottery', 'मिट्टी के बर्तन', 'https://media.example/c-pottery.webp'),
];

const stubApi = () =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/catalog/v1/categories')) return json({ data: TREE, locale: 'hi' });
        return json({ error: { code: 'not_found' } }, 404);
    });

let root: Root | null = null;
let container: HTMLDivElement;
const tree = (node: React.ReactNode, globalSettings: unknown, client: QueryClient) => (
    <QueryClientProvider client={client}>
        <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={globalSettings}>
            {node}
        </CommerceSiteProvider>
    </QueryClientProvider>
);
const render = async (node: React.ReactNode, globalSettings: unknown) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    container.setAttribute('data-catalogue-theme', 'default');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(tree(node, globalSettings, client));
    });
    return client;
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
const scrollTo = async (y: number) => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
    await act(async () => {
        window.dispatchEvent(new Event('scroll'));
    });
};
const nav = () => container.querySelector<HTMLElement>('nav.cmx-hbar')!;
const tiles = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('.cmx-hbar__panel a.cmx-hbar__tile'));
const box = (rect: Partial<DOMRect>) => () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...rect }) as DOMRect;

beforeEach(() => {
    at('/shop/c/sarees');
    useCommerceCart.setState({ key: null, cart: EMPTY_CART, hydrated: false, drawerOpen: false, lastAdded: null });
    stubApi();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
        fn(0);
        return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    for (const name of ['--cmx-pin-top', '--cmx-head-bottom']) document.documentElement.style.removeProperty(name);
    Reflect.deleteProperty(document.documentElement, 'scrollHeight');
    vi.unstubAllGlobals();
});

describe('the photo row (categoryBar.style "image")', () => {
    it('reserves its 96px in the page offset only for the image style', () => {
        const on = settings({ categoryBar: PHOTO_BAR });
        expect(categoryBarOffsetAt(on, 'shop', '/shop/c/sarees')).toEqual({ categoryBar: true, categoryPhotos: true });
        expect(categoryBarOffsetFor(on, 'homepage')).toEqual({ categoryBar: true, categoryPhotos: true });
        expect(categoryBarOffsetAt(settings({ categoryBar: { ...PHOTO_BAR, style: 'chips' } }), 'shop', '/shop/c/sarees')).toEqual({ categoryBar: true, categoryPhotos: false });
        expect(categoryBarOffsetAt(on, 'shop', '/shop/checkout')).toEqual({ categoryBar: false, categoryPhotos: false });
        expect(categoryBarOffsetFor(on, 'our-story')).toEqual({ categoryBar: false, categoryPhotos: false });
        expect(categoryBarOffsetAt({}, 'shop', '/shop')).toEqual({ categoryBar: false, categoryPhotos: false });
        // imagePages: the photo row on the listed pages only; the product page keeps the chip row.
        const some = settings({ categoryBar: { ...PHOTO_BAR, imagePages: ['home', 'shop', 'collection'] } });
        expect(categoryBarOffsetAt(some, 'shop', '/shop/c/sarees')).toEqual({ categoryBar: true, categoryPhotos: true });
        expect(categoryBarOffsetAt(some, 'shop', '/shop/p/red-saree')).toEqual({ categoryBar: true, categoryPhotos: false });
        expect(categoryBarOffsetFor(some, 'search')).toEqual({ categoryBar: true, categoryPhotos: false });
    });

    it('shows All, then a round photo per category with its Hindi name under it; a category without a photo is a chip', async () => {
        await render(<CategoryHeaderRow />, settings({ categoryBar: PHOTO_BAR }));
        await settle(() => tiles().length === 7);
        expect(nav().classList.contains('cmx-hbar--image')).toBe(true);
        // Open at the top of the page from the first paint.
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(true);
        expect(tiles().map((a) => a.textContent)).toEqual(['सब', 'साड़ियाँ', 'बैग', 'तौलिया', 'कपड़ा', 'दीये', 'मिट्टी के बर्तन']);
        // "All": a round tile with a mark, no photo.
        expect(tiles()[0]!.querySelector('.cmx-hbar__thumb--all svg')).not.toBeNull();
        expect(tiles()[0]!.getAttribute('href')).toContain('/shop');
        // A photo: sized, decorative (the name is the link's text), eager in the first five tiles, lazy after.
        const images = Array.from(container.querySelectorAll<HTMLImageElement>('.cmx-hbar__panel img'));
        expect(images.map((img) => img.getAttribute('src'))).toEqual([
            'https://media.example/c-sarees.webp',
            'https://media.example/c-towels.webp',
            'https://media.example/c-fabric.webp',
            'https://media.example/c-lamps.webp',
            'https://media.example/c-pottery.webp',
        ]);
        for (const img of images) {
            expect(img.getAttribute('width')).toBe('64');
            expect(img.getAttribute('height')).toBe('64');
            expect(img.getAttribute('alt')).toBe('');
        }
        expect(images.map((img) => img.getAttribute('loading'))).toEqual(['eager', 'eager', 'eager', 'lazy', 'lazy']);
        // बैग has no photo: its name as a chip on the photos' line.
        const bags = tiles()[2]!;
        expect(bags.classList.contains('cmx-hbar__tile--text')).toBe(true);
        expect(bags.querySelector('img')).toBeNull();
        expect(bags.querySelector('.cmx-hbar__pill')?.textContent).toBe('बैग');
        // The chip row is still there underneath, for the folded state.
        expect(Array.from(container.querySelectorAll('.cmx-hbar__row .cmx-hbar__chip')).map((a) => a.textContent)).toEqual([
            'सब', 'साड़ियाँ', 'बैग', 'तौलिया', 'कपड़ा', 'दीये', 'मिट्टी के बर्तन',
        ]);
    });

    it('marks the open category (the ring) in both rows, and outlines a product category', async () => {
        await render(<CategoryHeaderRow />, settings({ categoryBar: PHOTO_BAR }));
        await settle(() => tiles().length === 7);
        const current = container.querySelectorAll('.cmx-hbar__panel [aria-current]');
        expect(current).toHaveLength(1);
        expect(current[0]!.getAttribute('aria-current')).toBe('page');
        expect(current[0]!.textContent).toBe('साड़ियाँ');
        expect(container.querySelector('.cmx-hbar__row [aria-current="page"]')?.textContent).toBe('साड़ियाँ');
        await act(async () => root?.unmount());
        at('/shop/shop');
        await render(<CategoryHeaderRow />, settings({ categoryBar: PHOTO_BAR }));
        await settle(() => !!container.querySelector('.cmx-hbar__panel [aria-current="page"]'));
        expect(container.querySelector('.cmx-hbar__panel [aria-current="page"]')?.textContent).toBe('सब');
    });

    it('holds skeleton tiles while the categories load', async () => {
        vi.stubGlobal('fetch', () => new Promise(() => undefined));
        await render(<CategoryHeaderRow />, settings({ categoryBar: PHOTO_BAR }));
        expect(container.querySelectorAll('.cmx-hbar__panel .cmx-skel.cmx-hbar__thumb')).toHaveLength(5);
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(true);
    });

    it('folds into the chip row past 48px of scroll, opens again near the top, and cleans up', async () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
        await render(
            <header>
                <div>logo row</div>
                <CategoryHeaderRow />
            </header>,
            settings({ categoryBar: PHOTO_BAR })
        );
        await settle(() => tiles().length === 7);
        const header = container.querySelector('header')!;
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(true);
        await scrollTo(30);
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(true);
        await scrollTo(60);
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(false);
        // Collapsed is the 48px chip row: the logo row folds as before further down.
        await scrollTo(400);
        expect(header.hasAttribute('data-cmx-folded')).toBe(true);
        await scrollTo(30); // not yet near the top
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(false);
        expect(header.hasAttribute('data-cmx-folded')).toBe(false);
        await scrollTo(10);
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(true);
        // A keyboard user inside the photos keeps them.
        tiles()[3]!.focus();
        await scrollTo(200);
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(true);
        tiles()[3]!.blur();
        await scrollTo(210);
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(false);
        const navEl = nav();
        await act(async () => root?.unmount());
        root = null;
        expect(navEl.hasAttribute('data-cmx-expanded')).toBe(false);
        expect(header.hasAttribute('data-cmx-bar')).toBe(false);
    });

    it('starts folded when the page opens already scrolled', async () => {
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 900 });
        await render(
            <header>
                <CategoryHeaderRow />
            </header>,
            settings({ categoryBar: PHOTO_BAR })
        );
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(false);
    });

    it('shows the chip row only on a page outside imagePages (the product page)', async () => {
        const bar = { ...PHOTO_BAR, imagePages: ['home', 'shop', 'collection'] };
        at('/shop/p/red-saree');
        await render(<CategoryHeaderRow />, settings({ categoryBar: bar }));
        await settle(() => container.querySelectorAll('.cmx-hbar__row .cmx-hbar__chip').length === 7);
        expect(container.querySelector('.cmx-hbar__panel')).toBeNull();
        expect(nav().classList.contains('cmx-hbar--image')).toBe(false);
        expect(nav().classList.contains('cmx-hbar--chips')).toBe(true);
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(false);
        await act(async () => root?.unmount());
        at('/shop/c/sarees');
        await render(<CategoryHeaderRow />, settings({ categoryBar: bar }));
        await settle(() => tiles().length === 7);
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(true);
    });

    it('adds no photo row to the chips and tabs styles', async () => {
        await render(<CategoryHeaderRow />, settings({ categoryBar: { ...PHOTO_BAR, style: 'chips' } }));
        await settle(() => container.querySelectorAll('.cmx-hbar__chip').length === 7);
        expect(container.querySelector('.cmx-hbar__panel')).toBeNull();
        expect(nav().hasAttribute('data-cmx-expanded')).toBe(false);
        expect(nav().classList.contains('cmx-hbar--image')).toBe(false);
    });
});

describe('the pinned Filter·Sort row and the header fold', () => {
    it('keeps its top and follows the folded logo row with a transform (--cmx-pin-shift), as far as its place allows', async () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
        // A listing column with the sticky row as its first child (as in ListingView).
        const column = document.createElement('div');
        const toolbar = document.createElement('div');
        toolbar.className = 'cmx-toolbar cmx-toolbar--sticky';
        toolbar.style.top = '113px';
        column.appendChild(toolbar);
        document.body.appendChild(column);
        let columnTop = -800; // scrolled well past: the row is stuck
        column.getBoundingClientRect = () => box({ top: columnTop })();
        await render(
            <header>
                <div>logo row</div>
                <CategoryHeaderRow />
            </header>,
            settings({ categoryBar: { ...PHOTO_BAR, style: 'chips' } })
        );
        const header = container.querySelector('header')!;
        header.getBoundingClientRect = box({ top: 0, bottom: 113, height: 113 });
        nav().getBoundingClientRect = box({ top: 64, bottom: 112, height: 48 });
        expect(toolbar.style.getPropertyValue('--cmx-pin-shift')).toBe('');
        await scrollTo(400);
        expect(header.hasAttribute('data-cmx-folded')).toBe(true);
        // Folded: up by the whole fold (113 - 48 = 65), animated in step with the header.
        expect(toolbar.style.getPropertyValue('--cmx-pin-shift')).toBe('-65px');
        expect(toolbar.classList.contains('cmx-pin--anim')).toBe(true);
        // A row still on its way up (its place is 80px from the top) keeps pace with the page.
        columnTop = 80;
        await scrollTo(420);
        expect(toolbar.style.getPropertyValue('--cmx-pin-shift')).toBe('-33px');
        // Below its pin line: no shift.
        columnTop = 300;
        await scrollTo(440);
        expect(toolbar.style.getPropertyValue('--cmx-pin-shift')).toBe('');
        // Unfolded: back to its top.
        columnTop = -800;
        await scrollTo(460);
        expect(toolbar.style.getPropertyValue('--cmx-pin-shift')).toBe('-65px');
        await scrollTo(400);
        expect(header.hasAttribute('data-cmx-folded')).toBe(false);
        expect(toolbar.style.getPropertyValue('--cmx-pin-shift')).toBe('');
        await scrollTo(800);
        expect(toolbar.style.getPropertyValue('--cmx-pin-shift')).toBe('-65px');
        await act(async () => root?.unmount());
        root = null;
        expect(toolbar.style.getPropertyValue('--cmx-pin-shift')).toBe('');
    });

    it("says where every shop header ends (--cmx-head-bottom), with or without the bar, and clears it", async () => {
        await render(
            <header>
                <HeaderSlot />
            </header>,
            settings()
        );
        // jsdom lays nothing out: measure again with a real-looking header.
        const header = container.querySelector('header')!;
        header.getBoundingClientRect = box({ top: 0, bottom: 81, height: 81 });
        await act(async () => {
            window.dispatchEvent(new Event('resize'));
        });
        expect(document.documentElement.style.getPropertyValue('--cmx-head-bottom')).toBe('81px');
        await act(async () => root?.unmount());
        root = null;
        expect(document.documentElement.style.getPropertyValue('--cmx-head-bottom')).toBe('');
    });
});

describe('the desktop chip row with more chips than it holds', () => {
    it('is marked to scroll (no hover menus to clip) only while it overflows', async () => {
        await render(<CategoryHeaderRow />, settings({ categoryBar: { ...PHOTO_BAR, style: 'chips' } }));
        await settle(() => container.querySelectorAll('.cmx-hbar__chip').length === 7);
        expect(nav().classList.contains('cmx-hbar--over')).toBe(false);
        const row = container.querySelector<HTMLElement>('.cmx-hbar__row')!;
        Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 1400 });
        Object.defineProperty(row, 'clientWidth', { configurable: true, value: 1000 });
        await act(async () => {
            window.dispatchEvent(new Event('resize'));
        });
        expect(nav().classList.contains('cmx-hbar--over')).toBe(true);
        expect(nav().classList.contains('cmx-hbar--fade-end')).toBe(true);
    });
});

describe('the desktop row with sub-menus: the over state is stable', () => {
    // The commerce.css rules for the "over" state, without their desktop media query (jsdom
    // evaluates none), so the test reads what the shipped stylesheet does to the caret.
    const overRules = (): string => {
        const css = fs.readFileSync(path.resolve(__dirname, '../theme/commerce.css'), 'utf8');
        return css
            .split('\n')
            .filter((line) => line.includes('.cmx-hbar--over') && line.includes('{'))
            .join('\n');
    };

    it('hiding the carets never makes the row fit (no flicker loop when the observer fires)', async () => {
        let observed: ResizeObserverCallback | null = null;
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: ResizeObserverCallback) {
                    observed = callback;
                }
                observe() {}
                disconnect() {}
            }
        );
        const style = document.createElement('style');
        style.textContent = overRules();
        document.head.appendChild(style);
        const withChildren = TREE.map((c) => ({ ...c, children: [{ ...cat(`${c.slug}-sub`, 'उप', null), children: [] }] }));
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: withChildren, locale: 'hi' }), { status: 200, headers: { 'content-type': 'application/json' } }));
        await render(<CategoryHeaderRow />, settings({ categoryBar: { ...PHOTO_BAR, style: 'chips' } }));
        await settle(() => container.querySelectorAll('.cmx-hbar__caret').length === 6);
        const row = container.querySelector<HTMLElement>('.cmx-hbar__row')!;
        // 6 carets of 16px: the row overflows with them (1060 > 1000) and would fit without them
        // (964), the band that looped when the over state took the carets out of the layout.
        const caretsTakeRoom = () =>
            Array.from(container.querySelectorAll('.cmx-hbar__caret')).every((caret) => getComputedStyle(caret).display !== 'none');
        Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 1000 });
        Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => 964 + (caretsTakeRoom() ? 96 : 0) });
        await act(async () => {
            window.dispatchEvent(new Event('resize'));
        });
        expect(nav().classList.contains('cmx-hbar--over')).toBe(true);
        const states: boolean[] = [];
        for (let i = 0; i < 6; i += 1) {
            await act(async () => {
                observed?.([], {} as ResizeObserver);
            });
            states.push(nav().classList.contains('cmx-hbar--over'));
        }
        expect(states).toEqual([true, true, true, true, true, true]);
        // The caret only hides; the sub-menus are out (not reachable by Tab inside the clipped row).
        const caret = container.querySelector('.cmx-hbar__caret')!;
        expect(getComputedStyle(caret).visibility).toBe('hidden');
        expect(getComputedStyle(container.querySelector('.cmx-catbar__menu')!).display).toBe('none');
        style.remove();
    });
});

describe('the announcement strip', () => {
    it('keeps the whole text (CSS allows two lines on a phone)', async () => {
        const text = 'हाथ से बुना, 6–8 दिन में डिस्पैच · ₹80 डिलीवरी · ₹1,499* से ऊपर मुफ़्त · हर ऑर्डर बहनों की कमाई';
        await render(<AnnouncementBar props={{ text, route: 'policies' }} />, settings());
        expect(container.querySelector('.cmx-announce__text')?.textContent).toBe(text);
    });
});

describe('commerceSteps photos', () => {
    const ITEMS = [
        { title: 'भरोसा', text: 'हर ऑर्डर की जाँच होती है।', image: 'https://media.example/step-1.webp', imageAlt: 'जाँच की मेज़' },
        { title: 'सहायता', image: 'https://media.example/step-2.webp' },
        { title: 'सफ़ाई', image: 'step-3' }, // a placeholder, not an address: no photo
    ];

    it('puts each photo on top of its card (4:3, sized, lazy), with the text under the title', async () => {
        await render(<CommerceSectionView type="commerceSteps" props={{ title: 'हमारे मूल्य', items: ITEMS }} />, settings());
        const list = container.querySelector('ol.cmx-cards')!;
        expect(list.classList.contains('cmx-cards--photos')).toBe(true);
        expect(list.classList.contains('cmx-cards--3')).toBe(true);
        const cards = Array.from(list.querySelectorAll(':scope > li'));
        expect(cards).toHaveLength(3);
        const first = cards[0]!;
        expect(first.className).toBe('cmx-panel cmx-panel--media');
        expect(first.firstElementChild?.className).toBe('cmx-img cmx-step__img');
        const img = first.querySelector('img')!;
        expect(img.getAttribute('src')).toBe('https://media.example/step-1.webp');
        expect(img.getAttribute('alt')).toBe('जाँच की मेज़');
        expect(img.getAttribute('width')).toBe('800');
        expect(img.getAttribute('height')).toBe('600');
        expect(img.getAttribute('loading')).toBe('lazy');
        const body = first.querySelector('.cmx-panel__body')!;
        expect(Array.from(body.children).map((el) => el.tagName)).toEqual(['SPAN', 'H3', 'P']);
        expect(body.querySelector('h3')?.textContent).toBe('भरोसा');
        expect(body.querySelector('p')?.textContent).toBe('हर ऑर्डर की जाँच होती है।');
        expect(cards[1]!.querySelector('p')).toBeNull();
        expect(cards[2]!.querySelector('img')).toBeNull();
        expect(cards[2]!.querySelector('.cmx-step__img')).toBeNull();
        expect(cards[2]!.querySelector('h3')?.textContent).toBe('सफ़ाई');
    });

    it('without photos renders exactly as before', async () => {
        await render(
            <CommerceSectionView type="commerceSteps" props={{ items: [{ title: 'भरोसा', text: 'पाठ' }, { title: 'सहायता' }, { title: 'सफ़ाई' }, { title: 'समय' }] }} />,
            settings()
        );
        const list = container.querySelector('ol')!;
        expect(list.className).toBe('cmx-cards cmx-cards--4');
        const first = list.querySelector('li')!;
        expect(first.outerHTML).toBe(
            '<li class="cmx-panel"><span class="cmx-step__num" aria-hidden="true">1</span><h3 class="cmx-h3">भरोसा</h3><p class="cmx-p cmx-small">पाठ</p></li>'
        );
    });
});
