// @vitest-environment jsdom
/**
 * The news carousel (commerceNewsCarousel) as an authored page places it: the cards (photo
 * sizes and fit, date in the visitor's language, clamped excerpt, one link per card), items
 * outside their dates, arrows and dots round the ring, autoplay only when switched on (and every
 * reason it stops), and the platform-blog source. Plus a section opening at its anchor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/shop', search: '', hash: '', searchStr: '' },
}));
const blog = vi.hoisted(() => ({ calls: [] as unknown[], fail: false }));

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

vi.mock('../../../-services/blog-service', () => ({
    BlogService: {
        listPosts: async (instituteId: string, opts: unknown) => {
            blog.calls.push([instituteId, opts]);
            if (blog.fail) throw new Error('offline');
            return {
                content: [
                    // 20:00 UTC is 01:30 the next morning in India: the date is the reader's day.
                    { id: 'b1', slug: 'lamp-fair', title: 'दीया मेला', excerpt: 'मेले में नए दीये', cover_image_url: 'https://cdn.example/fair.jpg', published_at: '2026-10-19T20:00:00Z' },
                    { id: 'b2', slug: 'new-stall', title: 'नई दुकान', excerpt: null, cover_image_url: null, published_at: null },
                ],
                page: 0,
                size: 6,
                total_elements: 2,
                total_pages: 1,
                categories: [],
            };
        },
    },
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatNewsDate, readNews } from '../logic/news';
import { CommerceSectionView, COMMERCE_SECTION_TYPES } from './Sections';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const SETTINGS = { commerce: { enabled: true, publishableKey: KEY } };

const item = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `story-${n}`,
    date: `2026-0${n}-1${n}`,
    title: `समाचार ${n}`,
    excerpt: `सार ${n}`,
    image: `https://cdn.example/news-${n}.jpg`,
    imageAlt: `चित्र ${n}`,
    route: `news#story-${n}`,
    ...extra,
});
const ITEMS = [item(1), item(2, { imageFit: 'contain', imagePosition: '50% 30%' }), item(3, { route: 'https://press.example/3' }), item(4), item(5)];

let root: Root | null = null;
let container: HTMLDivElement;

const render = async (props: Record<string, unknown>, search = '', type = 'commerceNewsCarousel') => {
    router.location = { pathname: '/shop', search, hash: '', searchStr: search };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={SETTINGS}>
                    <CommerceSectionView type={type} props={props} />
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

const cards = () => Array.from(container.querySelectorAll('.cmx-news__item'));
const links = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('.cmx-news__card a'));
const fire = async (el: EventTarget, type: string, init: Record<string, unknown> = {}) => {
    await act(async () => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { value });
        el.dispatchEvent(event);
    });
};

/**
 * A desktop row: the track 900px wide, each card 284px with the 24px gap (three in view), and
 * scrollTo moving scrollLeft at once.
 */
const desktopLayout = () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('cmx-news') ? 900 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('cmx-news__item') ? 284 : 0;
    });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
        const style = real(el);
        if (!(el as HTMLElement).classList?.contains('cmx-news')) return style;
        return new Proxy(style, { get: (target, key) => (key === 'columnGap' ? '24px' : Reflect.get(target, key)) });
    });
    const scrolls: Array<{ left: number; behavior: string }> = [];
    (HTMLElement.prototype as unknown as { scrollTo: (o: { left: number; behavior: string }) => void }).scrollTo = function (this: HTMLElement, o) {
        scrolls.push(o);
        this.scrollLeft = o.left;
    };
    return scrolls;
};
const at = () => Array.from(container.querySelectorAll('.cmx-news__dots button')).findIndex((b) => b.getAttribute('aria-current') === 'true');
const tick = async (ms: number) =>
    act(async () => {
        vi.advanceTimersByTime(ms);
    });

beforeEach(() => {
    blog.calls.length = 0;
    blog.fail = false;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as unknown as { scrollTo?: unknown }).scrollTo;
});

describe('commerceNewsCarousel: reading the props', () => {
    it('keeps items with a title and a link, within their dates, at most 12; safe positions only', () => {
        const settings = readNews({
            items: [
                item(1),
                { title: 'no link' },
                { title: 'bad link', route: 'javascript:alert(1)' },
                item(2, { endDate: '2020-01-01' }),
                item(3, { imagePosition: 'url(x)' }),
                ...Array.from({ length: 20 }, (_, i) => item(4, { id: `x-${i}` })),
            ],
        });
        expect(settings.items[0]!.id).toBe('story-1');
        expect(settings.items.map((i) => i.title)).not.toContain('no link');
        expect(settings.items.map((i) => i.title)).not.toContain('bad link');
        expect(settings.items.map((i) => i.id)).not.toContain('story-2');
        expect(settings.items[1]!.imagePosition).toBe('');
        expect(settings.items).toHaveLength(12);
        // Defaults: 1 · 2 · 3 in view, 4:3, dates on, autoplay off at 7 s.
        expect(settings).toMatchObject({ perView: { phone: 1, tablet: 2, desktop: 3 }, imageRatio: '4:3', showDate: true, autoplay: false, intervalMs: 7000, pauseOnHover: true });
    });

    it('formats dates in the reader language with Latin digits, and nothing for a bad date', () => {
        expect(formatNewsDate('2026-04-27', 'hi')).toBe('27 अप्रैल 2026');
        expect(formatNewsDate('2026-04-27', 'en')).toBe('27 April 2026');
        expect(formatNewsDate('not a date', 'hi')).toBe('');
        expect(formatNewsDate('', 'en')).toBe('');
    });
});

describe('commerceNewsCarousel: the cards', () => {
    it('is a registered section type; renders nothing without a usable item', async () => {
        expect(COMMERCE_SECTION_TYPES).toContain('commerceNewsCarousel');
        await render({ items: [{ title: 'no link' }] });
        expect(container.querySelector('.cmx-news')).toBeNull();
    });

    it('draws the intro, photo (lazy, sized), Hindi date, clamped title and excerpt, and one link per card', async () => {
        await render({ title: 'समाचार एवं घटनाक्रम', cta: { label: 'सभी समाचार', route: 'news' }, items: ITEMS });
        const region = container.querySelector('.cmx-newsx')!;
        expect(region.getAttribute('role')).toBe('region');
        expect(region.getAttribute('aria-label')).toBe('समाचार एवं घटनाक्रम');
        expect(container.querySelector('h2')!.textContent).toBe('समाचार एवं घटनाक्रम');
        expect(container.querySelector('.cmx-intro a')!.getAttribute('href')).toBe('/shop/news');
        expect(container.querySelector('ul.cmx-news')!.className).toBe('cmx-news cmx-news--p1 cmx-news--t2 cmx-news--d3 cmx-news--r-4-3');
        expect(cards()).toHaveLength(5);
        const first = cards()[0]!;
        const img = first.querySelector('img')!;
        expect(img.getAttribute('loading')).toBe('lazy');
        expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['800', '600']);
        expect(img.getAttribute('alt')).toBe('चित्र 1');
        expect(first.querySelector('time')!.textContent).toBe('11 जनवरी 2026');
        expect(first.querySelector('time')!.getAttribute('datetime')).toBe('2026-01-11');
        expect(first.querySelector('h3')!.className).toContain('cmx-clamp--2');
        expect(first.querySelector('p')!.className).toContain('cmx-clamp');
        expect(first.querySelectorAll('a')).toHaveLength(1);
        expect(links().map((a) => a.getAttribute('href'))).toEqual(['/shop/news#story-1', '/shop/news#story-2', 'https://press.example/3', '/shop/news#story-4', '/shop/news#story-5']);
        expect(links()[0]!.textContent).toBe('और पढ़ें: समाचार 1');
        expect(links()[0]!.className).toContain('cmx-news__more');
        expect(links()[2]!.getAttribute('target')).toBe('_blank');
        // A clipping shows whole, at its focal point.
        const clip = cards()[1]!.querySelector<HTMLElement>('.cmx-news__img')!;
        expect(clip.className).toContain('cmx-news__img--contain');
        expect(clip.style.getPropertyValue('--cmx-news-pos')).toBe('50% 30%');
    });

    it('takes perView, the ratio, the label and showDate from the props', async () => {
        await render({ items: ITEMS, perView: { phone: 2, tablet: 3, desktop: 4 }, imageRatio: '16:9', readMoreLabel: 'पूरा पढ़ें', showDate: false });
        expect(container.querySelector('ul.cmx-news')!.className).toBe('cmx-news cmx-news--p2 cmx-news--t3 cmx-news--d4 cmx-news--r-16-9');
        const img = cards()[0]!.querySelector('img')!;
        expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['960', '540']);
        expect(links()[0]!.textContent).toContain('पूरा पढ़ें');
        expect(container.querySelector('time')).toBeNull();
    });

    it('speaks English on the English page', async () => {
        await render({ items: ITEMS }, '?lang=en');
        expect(links()[0]!.getAttribute('href')).toBe('/shop/news?lang=en#story-1');
        expect(links()[0]!.textContent).toContain('Read more');
        expect(cards()[0]!.querySelector('time')!.textContent).toBe('11 January 2026');
    });
});

describe('commerceNewsCarousel: moving', () => {
    it('has no arrows or dots when every card fits', async () => {
        await render({ items: ITEMS.slice(0, 2) });
        expect(container.querySelector('.cmx-news__btn')).toBeNull();
        expect(container.querySelector('.cmx-news__dots')).toBeNull();
    });

    it('arrows and dots move one card and go round the ring', async () => {
        const scrolls = desktopLayout();
        await render({ items: ITEMS });
        const [prev, next] = Array.from(container.querySelectorAll<HTMLButtonElement>('.cmx-news__btn'));
        expect(prev!.getAttribute('aria-label')).toBe('पिछले समाचार');
        expect(next!.getAttribute('aria-label')).toBe('अगले समाचार');
        // Five cards, three in view: three start positions.
        const dots = Array.from(container.querySelectorAll<HTMLButtonElement>('.cmx-news__dots button'));
        expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual(['3 में से 1 पर जाएँ', '3 में से 2 पर जाएँ', '3 में से 3 पर जाएँ']);
        expect(at()).toBe(0);
        await act(async () => next!.click());
        expect(scrolls.at(-1)).toEqual({ left: 308, behavior: 'smooth' });
        expect(container.querySelector('ul.cmx-news')!.hasAttribute('aria-live')).toBe(false);
        expect(at()).toBe(1);
        await act(async () => dots[2]!.click());
        expect(scrolls.at(-1)!.left).toBe(616);
        await act(async () => next!.click());
        expect(scrolls.at(-1)!.left).toBe(0);
        await act(async () => prev!.click());
        expect(scrolls.at(-1)!.left).toBe(616);
    });

    it('does not move by itself unless autoplay is on', async () => {
        vi.useFakeTimers();
        desktopLayout();
        await render({ items: ITEMS });
        await tick(60000);
        expect(at()).toBe(0);
        expect(container.querySelector('[aria-label="समाचार पट्टी रोकें"]')).toBeNull();
    });

    it('with autoplay: moves every intervalMs, stops on hover, a hidden tab, its pause button and for good after a tap', async () => {
        vi.useFakeTimers();
        desktopLayout();
        await render({ items: ITEMS, autoplay: true, intervalMs: 7000 });
        await tick(6999);
        expect(at()).toBe(0);
        await tick(1);
        expect(at()).toBe(1);
        const region = container.querySelector('.cmx-newsx')!;
        await fire(region, 'pointerover', { pointerType: 'mouse' });
        await tick(30000);
        expect(at()).toBe(1);
        await fire(region, 'pointerout', { pointerType: 'mouse' });
        await tick(7000);
        expect(at()).toBe(2);
        // Round the ring.
        await tick(7000);
        expect(at()).toBe(0);
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        await fire(document, 'visibilitychange');
        await tick(30000);
        expect(at()).toBe(0);
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        await fire(document, 'visibilitychange');
        const pause = container.querySelector<HTMLButtonElement>('[aria-label="समाचार पट्टी रोकें"]')!;
        await act(async () => pause.click());
        await tick(30000);
        expect(at()).toBe(0);
        await act(async () => pause.click());
        await tick(7000);
        expect(at()).toBe(1);
        await fire(container.querySelector('ul.cmx-news')!, 'touchstart');
        await tick(60000);
        expect(at()).toBe(1);
        // Once the visitor has moved it, the row stays put and its pause button goes (it would say the wrong thing).
        expect(container.querySelector('[aria-label="समाचार पट्टी रोकें"], [aria-label="समाचार पट्टी चलाएँ"]')).toBeNull();
        // The track is not a live region: moving it changes no text, and loading cards must not be read out.
        expect(container.querySelector('ul.cmx-news')!.hasAttribute('aria-live')).toBe(false);
    });

    it('with autoplay: stops while focus is inside, and never moves under reduced motion', async () => {
        vi.useFakeTimers();
        desktopLayout();
        await render({ items: ITEMS, autoplay: true, intervalMs: 3000 });
        await act(async () => links()[0]!.focus());
        await tick(30000);
        expect(at()).toBe(0);
        await act(async () => root?.unmount());
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
        await render({ items: ITEMS, autoplay: true, intervalMs: 3000 });
        await tick(30000);
        expect(at()).toBe(0);
        expect(container.querySelector('[aria-label="समाचार पट्टी रोकें"]')).toBeNull();
    });
});

describe('commerceNewsCarousel: the platform blog as the source', () => {
    it('lists the newest posts and opens each on the site blog page', async () => {
        await render({ source: 'blog', blogCategory: 'news', blogPage: 'blog', limit: 2.6 });
        await settle(() => !!container.querySelector('.cmx-news__card'));
        expect(cards()).toHaveLength(2);
        // A fractional limit is rounded before it reaches the server.
        expect(blog.calls).toEqual([['inst-1', { size: 3, category: 'news' }]]);
        expect(links().map((a) => a.getAttribute('href'))).toEqual(['/shop/blog/lamp-fair', '/shop/blog/new-stall']);
        // The reader's own day, not the UTC date's (the two differ here in India).
        const local = new Date('2026-10-19T20:00:00Z');
        expect(cards()[0]!.querySelector('time')!.textContent).toBe(formatNewsDate('2026-10-19T20:00:00Z', 'hi'));
        expect(cards()[0]!.querySelector('time')!.textContent!.startsWith(`${local.getDate()} `)).toBe(true);
        expect(cards()[0]!.querySelector('time')!.getAttribute('datetime')).toBe('2026-10-19T20:00:00Z');
    });

    it('renders nothing when the blog cannot be read', async () => {
        blog.fail = true;
        await render({ source: 'blog' });
        expect(container.querySelector('.cmx-news')!.getAttribute('aria-hidden')).toBe('true');
        await settle(() => !container.querySelector('.cmx-news'), 150);
        expect(blog.calls).toHaveLength(2);
        // No empty band is left where the row would have been.
        expect(container.querySelector('section')!.hidden).toBe(true);
    });
});

describe('a section opened at its anchor', () => {
    it('scrolls itself into view when the address names its anchor (it arrives after the browser jump)', async () => {
        const into = vi.fn();
        (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = into;
        window.history.replaceState(null, '', '/shop/news#story-2');
        await render({ anchor: 'story-2', title: 'समाचार 2', text: 'पूरी ख़बर' }, '', 'commerceFeature');
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 40));
        });
        expect(container.querySelector('section')!.id).toBe('story-2');
        expect(into).toHaveBeenCalledWith({ block: 'start' });
        into.mockClear();
        await act(async () => root?.unmount());
        await render({ anchor: 'story-3', title: 'समाचार 3' }, '', 'commerceFeature');
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 40));
        });
        expect(into).not.toHaveBeenCalled();
        window.history.replaceState(null, '', '/');
    });
});
