// @vitest-environment jsdom
/**
 * The rotating banner (commerceBannerCarousel) rendered as an authored page places it: the
 * timing (fake timers), every reason it stops moving (hover, focus, touch, hidden tab, the pause
 * button, reduced motion), swipe, dots and arrows, the image loading order, the fixed box, and
 * the fallback that holds that box while the shop's code loads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ location: { pathname: '/shop', search: '', hash: '', searchStr: '' } }));

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

// The shop chunk never arrives in this file, so CommerceSectionSlot shows its fallback.
vi.mock('../entry', () => new Promise(() => undefined));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommerceSectionSlot } from '../lazy';
import { CommerceSectionView, COMMERCE_SECTION_TYPES } from './Sections';
import { CommerceSiteProvider } from './site';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const SETTINGS = { commerce: { enabled: true, publishableKey: KEY } };

const slide = (n: number, extra: Record<string, unknown> = {}) => ({
    image: `https://cdn.example/banner-${n}.jpg`,
    headline: `शीर्षक ${n}`,
    text: `पंक्ति ${n}`,
    cta: { label: 'देखें', route: `c/set-${n}` },
    ...extra,
});
const PROPS = { slides: [slide(1, { imageMobile: 'https://cdn.example/banner-1-phone.jpg' }), slide(2), slide(3)] };

let root: Root | null = null;
let container: HTMLDivElement;

const render = async (props: Record<string, unknown>, locale = '') => {
    router.location = { pathname: '/shop', search: locale ? `?lang=${locale}` : '', hash: '', searchStr: locale ? `?lang=${locale}` : '' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={SETTINGS}>
                    <CommerceSectionView type="commerceBannerCarousel" props={props} />
                </CommerceSiteProvider>
            </QueryClientProvider>
        );
    });
};

const track = () => container.querySelector<HTMLElement>('.cmx-bx__track')!;
const current = () => {
    const m = /translate3d\((-?\d+)%/.exec(track().style.transform);
    return m ? Math.abs(Number(m[1])) / 100 : -1;
};
const advance = async (ms: number) => {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
};
const fire = async (el: EventTarget, type: string, init: Record<string, unknown> = {}) => {
    await act(async () => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { value });
        el.dispatchEvent(event);
    });
};
const media = (opts: { reduced?: boolean; phone?: boolean }) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: (!!opts.reduced && query.includes('prefers-reduced-motion')) || (!!opts.phone && query.includes('max-width: 639')),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    }));

beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('commerceBannerCarousel', () => {
    it('is a registered section type and renders nothing without a slide that has a photo', async () => {
        expect(COMMERCE_SECTION_TYPES).toContain('commerceBannerCarousel');
        await render({ slides: [{ headline: 'no photo' }] });
        expect(container.querySelector('.cmx-bx')).toBeNull();
        // ...and leaves no empty band: the section is hidden.
        expect(container.querySelector('section')!.hidden).toBe(true);
        await act(async () => root?.unmount());
        await render({ slides: [{ image: 'https://cdn.example/old.jpg', endDate: '2020-01-01' }] });
        expect(container.querySelector('section')!.hidden).toBe(true);
        await act(async () => root?.unmount());
        await render(PROPS);
        expect(container.querySelector('section')!.hidden).toBe(false);
    });

    it('moves on every 5 seconds by default, round the ring, by transform only', async () => {
        await render(PROPS);
        expect(current()).toBe(0);
        await advance(4999);
        expect(current()).toBe(0);
        await advance(1);
        expect(current()).toBe(1);
        await advance(5000);
        expect(current()).toBe(2);
        await advance(5000);
        expect(current()).toBe(0);
        // The box never changes size: the slides move with a transform.
        expect(track().getAttribute('style')).toMatch(/^transform: translate3d\(/);
    });

    it('takes its interval from the props (bounded to 2-15 s), a phone interval below 640px, and none with autoplay false', async () => {
        await render({ ...PROPS, intervalMs: 8000 });
        await advance(5000);
        expect(current()).toBe(0);
        await advance(3000);
        expect(current()).toBe(1);
        await act(async () => root?.unmount());
        await render({ ...PROPS, intervalMs: 500 });
        await advance(1999);
        expect(current()).toBe(0);
        await advance(1);
        expect(current()).toBe(1);
        await act(async () => root?.unmount());
        media({ phone: true });
        await render({ ...PROPS, intervalMs: 3000, intervalMsPhone: 5000 });
        await advance(3000);
        expect(current()).toBe(0);
        await advance(2000);
        expect(current()).toBe(1);
        await act(async () => root?.unmount());
        await render({ ...PROPS, autoplay: false });
        await advance(60000);
        expect(current()).toBe(0);
        expect(container.querySelector('.cmx-bx__toggle')).toBeNull();
    });

    it('stops while the mouse is over it and starts again from a full interval when it leaves', async () => {
        await render(PROPS);
        const box = container.querySelector('.cmx-bx')!;
        await advance(3000);
        await fire(box, 'pointerover', { pointerType: 'mouse' });
        await advance(10000);
        expect(current()).toBe(0);
        await fire(box, 'pointerout', { pointerType: 'mouse' });
        await advance(4999);
        expect(current()).toBe(0);
        await advance(1);
        expect(current()).toBe(1);
    });

    it('stops while something in it has focus', async () => {
        await render(PROPS);
        const dot = container.querySelector<HTMLButtonElement>('.cmx-bx__dot')!;
        await act(async () => dot.focus());
        await advance(20000);
        expect(current()).toBe(0);
        await act(async () => dot.blur());
        await advance(5000);
        expect(current()).toBe(1);
    });

    it('stops while a finger is on it, and a sideways swipe changes the slide', async () => {
        await render(PROPS);
        const box = container.querySelector('.cmx-bx')!;
        await fire(box, 'touchstart', { touches: [{ clientX: 300, clientY: 100 }] });
        await advance(20000);
        expect(current()).toBe(0);
        // Right to left: the next slide.
        await fire(box, 'touchend', { changedTouches: [{ clientX: 200, clientY: 110 }] });
        expect(current()).toBe(1);
        // Left to right: back.
        await fire(box, 'touchstart', { touches: [{ clientX: 100, clientY: 100 }] });
        await fire(box, 'touchend', { changedTouches: [{ clientX: 220, clientY: 100 }] });
        expect(current()).toBe(0);
        // Mostly vertical: the page scrolling, not a swipe.
        await fire(box, 'touchstart', { touches: [{ clientX: 100, clientY: 100 }] });
        await fire(box, 'touchend', { changedTouches: [{ clientX: 160, clientY: 300 }] });
        expect(current()).toBe(0);
        // After the finger lifts it moves on again, a full interval later.
        await advance(5000);
        expect(current()).toBe(1);
    });

    it('stops while the tab is hidden', async () => {
        await render(PROPS);
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        await fire(document, 'visibilitychange');
        await advance(20000);
        expect(current()).toBe(0);
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        await fire(document, 'visibilitychange');
        await advance(5000);
        expect(current()).toBe(1);
    });

    it('has a pause button that stops it until it is pressed again', async () => {
        await render(PROPS);
        const toggle = container.querySelector<HTMLButtonElement>('.cmx-bx__toggle')!;
        expect(toggle.getAttribute('aria-label')).toBe('बैनर रोकें');
        await act(async () => {
            toggle.click();
            toggle.blur();
        });
        expect(toggle.getAttribute('aria-label')).toBe('बैनर चलाएँ');
        await advance(30000);
        expect(current()).toBe(0);
        await act(async () => {
            toggle.click();
            toggle.blur();
        });
        await advance(5000);
        expect(current()).toBe(1);
    });

    it('never moves by itself for a visitor who asked for reduced motion, and has no pause button then', async () => {
        media({ reduced: true });
        await render(PROPS);
        await advance(60000);
        expect(current()).toBe(0);
        expect(container.querySelector('.cmx-bx__toggle')).toBeNull();
        expect(track().classList.contains('cmx-bx__track--still')).toBe(true);
        // It still moves by hand, and it announces the change.
        expect(track().getAttribute('aria-live')).toBe('polite');
        await act(async () => container.querySelector<HTMLButtonElement>('.cmx-bx__arrow--next')!.click());
        expect(current()).toBe(1);
    });

    it('labels the arrows and dots, and marks the current dot and slide', async () => {
        await render(PROPS);
        const box = container.querySelector('.cmx-bx')!;
        expect(box.getAttribute('role')).toBe('region');
        expect(box.getAttribute('aria-roledescription')).toBe('घूमते बैनर');
        expect(container.querySelector('.cmx-bx__arrow--prev')!.getAttribute('aria-label')).toBe('पिछला बैनर');
        expect(container.querySelector('.cmx-bx__arrow--next')!.getAttribute('aria-label')).toBe('अगला बैनर');
        const dots = Array.from(container.querySelectorAll('.cmx-bx__dot'));
        expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual(['3 में से बैनर 1 दिखाएँ', '3 में से बैनर 2 दिखाएँ', '3 में से बैनर 3 दिखाएँ']);
        expect(dots[0]!.getAttribute('aria-current')).toBe('true');
        await act(async () => (dots[2] as HTMLButtonElement).click());
        expect(current()).toBe(2);
        expect(dots[2]!.getAttribute('aria-current')).toBe('true');
        const slides = Array.from(container.querySelectorAll('.cmx-bx__slide'));
        expect(slides.map((s) => s.getAttribute('aria-hidden'))).toEqual(['true', 'true', null]);
        expect(slides[2]!.getAttribute('aria-label')).toBe('3 में से 3');
        // The hidden slides cannot be tabbed into.
        expect(slides[0]!.hasAttribute('inert')).toBe(true);
        expect(slides[2]!.hasAttribute('inert')).toBe(false);
        // Prev from the first goes round to the last.
        await act(async () => (dots[0] as HTMLButtonElement).click());
        await act(async () => container.querySelector<HTMLButtonElement>('.cmx-bx__arrow--prev')!.click());
        expect(current()).toBe(2);
        // Arrow keys too, from the dots and arrows.
        await act(async () => {
            dots[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });
        expect(current()).toBe(0);
        // Not from a slide's own link: that slide would turn inert under the visitor's focus.
        const cta = container.querySelector<HTMLAnchorElement>('.cmx-bx__slide--on .cmx-bx__copy a')!;
        await act(async () => {
            cta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });
        expect(current()).toBe(0);
    });

    it('loads only the first photo at once (fetchpriority high); the others lazily, each as it comes next', async () => {
        await render(PROPS);
        const imgs = () => Array.from(container.querySelectorAll<HTMLImageElement>('.cmx-bx__slide img'));
        // Slide 1 (with its phone picture in a <picture>) and slide 2, which is next; slide 3 has no address yet.
        expect(imgs().map((i) => i.getAttribute('src'))).toEqual(['https://cdn.example/banner-1.jpg', 'https://cdn.example/banner-2.jpg']);
        const [first, second] = imgs();
        expect(first!.getAttribute('loading')).toBe('eager');
        expect(first!.getAttribute('fetchpriority')).toBe('high');
        expect(first!.getAttribute('width')).toBe('1600');
        expect(first!.getAttribute('height')).toBe('850');
        expect(container.querySelector('picture source')!.getAttribute('media')).toBe('(max-width: 639.98px)');
        expect(container.querySelector('picture source')!.getAttribute('srcset')).toBe('https://cdn.example/banner-1-phone.jpg');
        expect(second!.getAttribute('loading')).toBe('lazy');
        expect(second!.hasAttribute('fetchpriority')).toBe(false);
        await advance(5000);
        expect(imgs()).toHaveLength(3);
        expect(imgs()[2]!.getAttribute('loading')).toBe('lazy');
    });

    it('keeps one box per breakpoint (aspect ratios as variables), never taller than 4:5 on a phone', async () => {
        await render({ ...PROPS, ratioPhone: '1:1', ratio: '32:17' });
        const box = () => container.querySelector<HTMLElement>('.cmx-bx')!;
        expect(box().style.getPropertyValue('--cmx-bx-m')).toBe('1 / 1');
        expect(box().style.getPropertyValue('--cmx-bx-d')).toBe('32 / 17');
        expect(container.querySelector('.cmx-bx__headline')!.textContent).toBe('शीर्षक 1');
        const button = container.querySelector('.cmx-bx__copy a')!;
        expect(button.textContent).toBe('देखें');
        expect(button.getAttribute('href')).toBe('/shop/c/set-1');
        await act(async () => root?.unmount());
        // A tall 9:16 phone picture gets the 4:5 box; unreadable ratios fall back to 4:5 and 21:9.
        await render({ ...PROPS, ratioPhone: '9:16', ratio: 'wide' });
        expect(box().style.getPropertyValue('--cmx-bx-m')).toBe('4 / 5');
        expect(box().style.getPropertyValue('--cmx-bx-d')).toBe('21 / 9');
    });

    it('fades instead of sliding when asked: opacity only, no transform', async () => {
        await render({ ...PROPS, transition: 'fade', transitionMs: 300 });
        const box = container.querySelector<HTMLElement>('.cmx-bx')!;
        expect(box.className).toContain('cmx-bx--fade');
        expect(box.style.getPropertyValue('--cmx-bx-ms')).toBe('300ms');
        expect(track().getAttribute('style')).toBeNull();
        const on = () => Array.from(container.querySelectorAll('.cmx-bx__slide')).findIndex((s) => s.classList.contains('cmx-bx__slide--on'));
        expect(on()).toBe(0);
        await advance(5000);
        expect(on()).toBe(1);
    });

    it('shows the English pictures to an English visitor, else the base ones', async () => {
        const props = { slides: [slide(1, { headline: '', text: '', cta: null, alt: 'दीपावली', imageEn: 'https://cdn.example/en.jpg', imageMobile: 'https://cdn.example/hi-phone.jpg', imageMobileEn: 'https://cdn.example/en-phone.jpg' }), slide(2)] };
        await render(props, 'en');
        expect(container.querySelector('.cmx-bx__slide img')!.getAttribute('src')).toBe('https://cdn.example/en.jpg');
        expect(container.querySelector('.cmx-bx__slide source')!.getAttribute('srcset')).toBe('https://cdn.example/en-phone.jpg');
        expect(container.querySelector('.cmx-bx__slide img')!.getAttribute('alt')).toBe('दीपावली');
        await act(async () => root?.unmount());
        await render(props);
        expect(container.querySelector('.cmx-bx__slide img')!.getAttribute('src')).toBe('https://cdn.example/banner-1.jpg');
        expect(container.querySelector('.cmx-bx__slide source')!.getAttribute('srcset')).toBe('https://cdn.example/hi-phone.jpg');
    });

    it('can leave out the arrows and dots (the pause button stays while it moves), and not pause on hover', async () => {
        await render({ ...PROPS, showArrows: false, showDots: false, pauseOnHover: false });
        expect(container.querySelector('.cmx-bx__arrow--next')).toBeNull();
        expect(container.querySelector('.cmx-bx__dot')).toBeNull();
        expect(container.querySelector('.cmx-bx__toggle')).toBeTruthy();
        await fire(container.querySelector('.cmx-bx')!, 'pointerover', { pointerType: 'mouse' });
        await advance(5000);
        expect(current()).toBe(1);
    });

    it('makes a photo-only slide the link itself, and leaves out slides outside their dates', async () => {
        await render({
            slides: [
                { image: 'https://cdn.example/art.jpg', alt: 'दिवाली सेल', route: 'c/diwali' },
                { image: 'https://cdn.example/old.jpg', endDate: '2020-01-01' },
            ],
        });
        const link = container.querySelector('.cmx-bx__media')!;
        expect(link.tagName).toBe('A');
        expect(link.getAttribute('aria-label')).toBe('दिवाली सेल');
        expect(container.querySelectorAll('.cmx-bx__slide')).toHaveLength(1);
        await act(async () => root?.unmount());
        // A linked picture without alt still says where it goes, not just "banner".
        await render({ slides: [{ image: 'https://cdn.example/art.jpg', route: 'c/diwali' }, { image: 'https://cdn.example/b.jpg' }] });
        expect(container.querySelector('.cmx-bx__media')!.getAttribute('aria-label')).toBe('बैनर 1 (2 में से) खोलें');
        await act(async () => root?.unmount());
        await render({ slides: [{ image: 'https://cdn.example/art.jpg', alt: 'दिवाली सेल', route: 'c/diwali' }, { image: 'https://cdn.example/old.jpg', endDate: '2020-01-01' }] });
        // One slide: no dots, no arrows, no timer.
        expect(container.querySelector('.cmx-bx__dot')).toBeNull();
        expect(container.querySelector('.cmx-bx__arrow--next')).toBeNull();
    });

    it('speaks English on the English page', async () => {
        await render(PROPS, 'en');
        expect(container.querySelector('.cmx-bx__arrow--next')!.getAttribute('aria-label')).toBe('Next slide');
        expect(container.querySelector('.cmx-bx__toggle')!.getAttribute('aria-label')).toBe('Pause the slides');
    });
});

describe('the banner fallback while the shop code loads', () => {
    it('holds the same box: the section padding, the phone and desktop ratios, and the dots row', async () => {
        vi.useRealTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root!.render(
                <CommerceSectionSlot
                    instituteId="inst-1"
                    tagName="shop"
                    globalSettings={SETTINGS}
                    type="commerceBannerCarousel"
                    props={{ ...PROPS, ratioPhone: '1:1', ratio: '32:17' }}
                />
            );
        });
        const shell = container.querySelector<HTMLElement>('.py-8 > div')!;
        expect(shell).toBeTruthy();
        expect(shell.style.getPropertyValue('--cmx-bx-m')).toBe('1 / 1');
        expect(shell.style.getPropertyValue('--cmx-bx-d')).toBe('32 / 17');
        expect(shell.querySelector('.sm\\:aspect-\\[var\\(--cmx-bx-d\\)\\]')).toBeTruthy();
        expect(shell.querySelector('.aspect-\\[var\\(--cmx-bx-m\\)\\]')).toBeTruthy();
        expect(shell.querySelector('.h-11')).toBeTruthy();
    });

    it('is nothing on a site without a shop', async () => {
        vi.useRealTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root!.render(<CommerceSectionSlot instituteId="inst-1" tagName="site" globalSettings={{}} type="commerceBannerCarousel" props={PROPS} />);
        });
        expect(container.innerHTML).toBe('');
    });
});
