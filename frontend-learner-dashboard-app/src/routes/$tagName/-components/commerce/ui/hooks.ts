import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import {
    readScrollPositions,
    rememberScroll,
    scrollKey,
    scrollTarget,
    writeScrollPositions,
    type NavigationKind,
    type ScrollPositions,
} from '../logic/scroll';
import { holdZoomableViewport } from '../logic/viewport';
import { useCommerceSite } from './site';

const FONT_LINK_ID = 'commerce-fonts';

/** The Google Fonts stylesheet of the shop's two families: two weights each, font-display swap. */
export const commerceFontsHref = (families: readonly string[]): string | null => {
    const names = Array.from(new Set(families.map((f) => f.trim()).filter((f) => /^[A-Za-z0-9 ]{2,40}$/.test(f))));
    if (names.length === 0) return null;
    return `https://fonts.googleapis.com/css2?${names.map((n) => `family=${n.replace(/ /g, '+')}:wght@400;600`).join('&')}&display=swap`;
};

/* ── scroll and focus between shop pages ──────────────────────────── */

/**
 * Back and Forward arrive as popstate; a tap or a key press that follows is a new navigation.
 * Registered once with the shop's code, which is on every page of a site with a shop.
 */
let popPending = false;
let positions: ScrollPositions | null = null;
let shopPageSeen = false;
if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => {
        popPending = true;
    });
    const clear = () => {
        popPending = false;
    };
    window.addEventListener('click', clear, true);
    window.addEventListener('keydown', clear, true);
}

const sessionStore = (): Storage | null => {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
};

/** True when the document itself was loaded at this address (not reached by a tap inside the app). */
const loadedHere = (pathname: string): boolean => {
    try {
        const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return !!entry && new URL(entry.name).pathname.replace(/\/+$/, '') === pathname.replace(/\/+$/, '');
    } catch {
        return false;
    }
};

/**
 * Scroll and focus of the fixed shop routes (the hosted-site routes are left alone by the
 * app's own scroll reset). A page opened by a tap starts at the top with focus on its main
 * region; Back and Forward return to where the shopper was, once the cached listing has drawn;
 * filters, the variant and the language change the address without moving the page.
 */
export const useShopScroll = (pageId: string, main: React.RefObject<HTMLElement | null>): void => {
    const pathname = useLocation({ select: (l) => l.pathname });
    const searchStr = useLocation({ select: (l) => l.searchStr || '' });
    const key = scrollKey(pathname, searchStr);
    const keyRef = useRef(key);
    const lastPage = useRef<string | null>(null);

    // Remember the offset of the address on screen while the shopper scrolls.
    useEffect(() => {
        if (positions === null) positions = readScrollPositions(sessionStore());
        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                positions = rememberScroll(positions || {}, keyRef.current, window.scrollY);
            });
        };
        const persist = () => writeScrollPositions(sessionStore(), positions || {});
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('pagehide', persist);
        return () => {
            if (frame) cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('pagehide', persist);
            persist();
        };
    }, []);

    useLayoutEffect(() => {
        const samePage = lastPage.current === pageId;
        const first = lastPage.current === null;
        lastPage.current = pageId;
        keyRef.current = key;
        if (samePage) return;
        if (positions === null) positions = readScrollPositions(sessionStore());
        const kind: NavigationKind = popPending ? 'pop' : first && !shopPageSeen && loadedHere(pathname) ? 'load' : 'push';
        popPending = false;
        shopPageSeen = true;
        const target = scrollTarget({ kind, samePage: false, remembered: positions[key] });
        if (kind !== 'load') main.current?.focus({ preventScroll: true });
        if (target === null) return;
        if (target === 0) {
            window.scrollTo(0, 0);
            return;
        }
        // The listing may still be drawing its cached pages: try until the page is tall enough,
        // and stop as soon as the shopper scrolls by hand.
        let frame = 0;
        let tries = 0;
        const stop = () => {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            window.removeEventListener('wheel', stop);
            window.removeEventListener('touchstart', stop);
        };
        const attempt = () => {
            const reachable = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo(0, Math.min(target, Math.max(0, reachable)));
            tries += 1;
            if (reachable >= target || tries > 90) stop();
            else frame = requestAnimationFrame(attempt);
        };
        window.addEventListener('wheel', stop, { passive: true });
        window.addEventListener('touchstart', stop, { passive: true });
        attempt();
        return stop;
        // The address is read when the PAGE changes; filters and language do not move it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageId]);

    // Keep the key in step with filter changes on the same page.
    useEffect(() => {
        keyRef.current = key;
    }, [key]);
};

/**
 * Loads the shop's display and text fonts (globalSettings.commerce.theme.fonts; Laila and
 * Mukta for the Heritage preset). On a product or collection page the edge has already put the
 * same stylesheet in the document, and this finds it there instead of adding a second one.
 */
export const useCommerceFonts = (): void => {
    const { config } = useCommerceSite();
    const { displayFont, textFont } = config.theme;
    useEffect(() => {
        const href = commerceFontsHref([displayFont, textFont]);
        if (!href || typeof document === 'undefined') return;
        const present = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(
            (link) => link.href === href && link.id !== FONT_LINK_ID
        );
        let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
        if (present && !link) return;
        if (!link) {
            link = document.createElement('link');
            link.id = FONT_LINK_ID;
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
        if (link.href !== href) link.href = href;
    }, [displayFont, textFont]);
};

/** False while the browser reports no connection (the cart still works locally). */
export const useOnline = (): boolean => {
    const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);
    return online;
};

/** True when the visitor asked for less motion; read at the first render, followed after. */
export const useReducedMotion = (): boolean => useMediaQuery('(prefers-reduced-motion: reduce)');

/** True while the media query matches (false where there is no matchMedia). */
export const useMediaQuery = (query: string): boolean => {
    const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
    useEffect(() => {
        const list = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
        if (!list) return;
        const update = () => setMatches(list.matches);
        update();
        list.addEventListener?.('change', update);
        return () => list.removeEventListener?.('change', update);
    }, [query]);
    return matches;
};

/** True while the tab is in the background (another tab, a locked phone). */
export const usePageHidden = (): boolean => {
    const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
    useEffect(() => {
        const update = () => setHidden(document.visibilityState === 'hidden');
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    return hidden;
};

/** Pinch-zoom allowed while a shop root is on screen (logic/viewport.ts). */
export const useZoomableViewport = (): void => {
    useEffect(() => holdZoomableViewport(), []);
};

/* ── the fixed site header: where it ends, the fold, the photo row ── */

/** The vertical translate of an element's computed transform (0 when none). */
export const translateYOf = (el: Element): number => {
    const value = typeof getComputedStyle === 'function' ? getComputedStyle(el).transform : '';
    if (!value || value === 'none') return 0;
    const numbers = value.slice(value.indexOf('(') + 1, -1).split(',').map((n) => parseFloat(n));
    const y = value.startsWith('matrix3d') ? numbers[13] : numbers[5];
    return typeof y === 'number' && Number.isFinite(y) ? y : 0;
};

/**
 * Keeps --cmx-head-bottom on <html> at the bottom of the fixed site header as laid out (a fold's
 * transform left out): where a pinned row (the sticky Filter·Sort bar) sits. Measured, so the
 * full bar from 768px, a compact bar and the app's taller header all fit. Every shop header.
 */
export const useHeaderBottom = (ref: React.RefObject<HTMLElement | null>): void => {
    useEffect(() => {
        const header = ref.current?.closest('header');
        if (!header || typeof window === 'undefined') return;
        const root = document.documentElement;
        let frame = 0;
        const measure = () => {
            frame = 0;
            const bottom = header.getBoundingClientRect().bottom - translateYOf(header);
            if (bottom > 0) root.style.setProperty('--cmx-head-bottom', `${Math.round(bottom)}px`);
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
        };
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
        observer?.observe(header);
        window.addEventListener('resize', schedule);
        return () => {
            if (frame) cancelAnimationFrame(frame);
            observer?.disconnect();
            window.removeEventListener('resize', schedule);
            root.style.removeProperty('--cmx-head-bottom');
        };
    }, [ref]);
};

/** Below this scroll offset the logo row is always shown. */
const FOLD_MIN_Y = 160;
/** Downward travel since the last turn that folds the logo row. */
const FOLD_DOWN = 12;
/** Upward travel since the last turn that brings it back. */
const FOLD_UP = 24;
/** Photo row ("image" style): it folds into the chip row once the page has scrolled past the 48px it adds… */
export const PHOTO_ROW_COLLAPSE_Y = 48;
/** …and opens again near the top. */
export const PHOTO_ROW_EXPAND_Y = 16;
/** Rows pinned under the header that move with the fold. */
const PINNED_ROWS = '.cmx-toolbar--sticky';
/** How long a pinned row animates after a fold or unfold (the header's own 200ms). */
const PIN_ANIMATION_MS = 240;

/**
 * Where a row would sit if it were not sticky: under its previous sibling (plus the parent's
 * gap), or at the top of its parent's content.
 */
const staticTopOf = (el: HTMLElement): number => {
    const parent = el.parentElement;
    if (!parent) return el.getBoundingClientRect().top;
    const margin = parseFloat(getComputedStyle(el).marginTop) || 0;
    const prev = el.previousElementSibling as HTMLElement | null;
    const style = getComputedStyle(parent);
    if (prev) return prev.getBoundingClientRect().bottom + (parseFloat(style.rowGap) || 0) + margin;
    return parent.getBoundingClientRect().top + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0) + margin;
};

/**
 * The fixed site header with the category bar (`navRef` is the bar):
 * - keeps --cmx-pin-top on <html> at the header's visible bottom (the desktop product photo);
 * - with `collapse`, folds the logo row away on scroll-down on phones and tablets. The fold is a
 *   transform on the fixed header, so nothing in the page moves; the bar itself never hides.
 *   A pinned row (the sticky Filter·Sort bar) keeps its `top` and follows with a transform
 *   (--cmx-pin-shift): with the logo row folded it rides up under the bar;
 * - with `photos` ("image" style), opens the photo row (data-cmx-expanded) at the top of the page
 *   and folds it into the chip row past PHOTO_ROW_COLLAPSE_Y (opacity and transform only).
 * Listeners are passive and run once per frame.
 */
export const useHeaderFold = (
    navRef: React.RefObject<HTMLElement | null>,
    collapse: boolean,
    paused: boolean,
    photos = false
): void => {
    const pausedRef = useRef(paused);
    const unfoldRef = useRef<(() => void) | null>(null);
    pausedRef.current = paused;

    useEffect(() => {
        const nav = navRef.current;
        const header = nav?.closest('header');
        if (!nav || !header || typeof window === 'undefined') return;
        const root = document.documentElement;
        const narrow = window.matchMedia ? window.matchMedia('(max-width: 1023.98px)') : null;
        let folded = false;
        let foldBy = 0;
        let lastY = window.scrollY;
        let anchorY = lastY;
        let direction = 0;
        let frame = 0;
        let animTimer = 0;
        const shifts = new Map<HTMLElement, number>();

        // The pinned rows: no shift with the logo row shown; folded, they follow the bar up as
        // far as their own place in the page allows (a row still below its pin line stays put).
        const placePinned = (animate: boolean) => {
            const rows = Array.from(document.querySelectorAll<HTMLElement>(PINNED_ROWS));
            const next = rows.map((row) => {
                if (!folded) return 0;
                const rest = parseFloat(getComputedStyle(row).top) || 0;
                return Math.max(-foldBy, Math.min(0, Math.round(staticTopOf(row) - rest)));
            });
            rows.forEach((row, i) => {
                const shift = next[i]!;
                if ((shifts.get(row) ?? 0) === shift && !animate) return;
                shifts.set(row, shift);
                if (animate) {
                    row.classList.add('cmx-pin--anim');
                    window.clearTimeout(animTimer);
                    animTimer = window.setTimeout(() => {
                        document.querySelectorAll('.cmx-pin--anim').forEach((el) => el.classList.remove('cmx-pin--anim'));
                    }, PIN_ANIMATION_MS);
                }
                if (shift === 0) row.style.removeProperty('--cmx-pin-shift');
                else row.style.setProperty('--cmx-pin-shift', `${shift}px`);
            });
        };

        const apply = (next: boolean) => {
            const changed = next !== folded;
            folded = next;
            const height = header.getBoundingClientRect().height;
            const bar = nav.getBoundingClientRect().height;
            foldBy = Math.max(0, Math.round(height - bar));
            header.style.setProperty('--cmx-fold', `${foldBy}px`);
            header.toggleAttribute('data-cmx-folded', next);
            root.style.setProperty('--cmx-pin-top', `${Math.round(next ? bar : height)}px`);
            placePinned(changed);
        };
        const unfold = () => {
            if (folded) apply(false);
        };
        unfoldRef.current = unfold;
        header.setAttribute('data-cmx-bar', '');

        // The photo row and the header's own colour, for the part of it that hangs below the header.
        const panel = photos ? nav.querySelector<HTMLElement>('.cmx-hbar__panel') : null;
        let expanded = false;
        const setExpanded = (next: boolean) => {
            expanded = next;
            nav.toggleAttribute('data-cmx-expanded', next);
        };
        if (panel) {
            const background = getComputedStyle(header).backgroundColor;
            // An opaque colour only: a see-through header would show the page through the photos.
            if (/^rgb\(/.test(background)) nav.style.setProperty('--cmx-hbar-bg', background);
            setExpanded(window.scrollY < PHOTO_ROW_COLLAPSE_Y);
        }
        apply(false);

        const canFold = () =>
            collapse &&
            !!narrow?.matches &&
            !pausedRef.current &&
            // A drawer, sheet or search overlay is open (Radix locks the page scroll).
            !document.body.hasAttribute('data-scroll-locked') &&
            // A short page never folds.
            root.scrollHeight >= window.innerHeight * 2;

        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const y = window.scrollY;
                const dy = y - lastY;
                lastY = y;
                if (panel) {
                    // Never fold the photos away from under a keyboard user.
                    if (expanded && y >= PHOTO_ROW_COLLAPSE_Y && !panel.contains(document.activeElement)) setExpanded(false);
                    else if (!expanded && y <= PHOTO_ROW_EXPAND_Y) setExpanded(true);
                }
                if (!canFold() || y < FOLD_MIN_Y) {
                    unfold();
                    anchorY = y;
                    return;
                }
                if (dy !== 0) {
                    const turn = dy > 0 ? 1 : -1;
                    if (turn !== direction) {
                        direction = turn;
                        anchorY = y - dy;
                    }
                    if (turn > 0 && !folded && y - anchorY >= FOLD_DOWN) return apply(true);
                    if (turn < 0 && folded && anchorY - y >= FOLD_UP) return apply(false);
                }
                // Folded, a pinned row on its way up keeps pace with the page until it meets the bar.
                if (folded) placePinned(false);
            });
        };
        const onResize = () => apply(folded && canFold());
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize);
        header.addEventListener('focusin', unfold);
        narrow?.addEventListener?.('change', onResize);
        return () => {
            if (frame) cancelAnimationFrame(frame);
            window.clearTimeout(animTimer);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onResize);
            header.removeEventListener('focusin', unfold);
            narrow?.removeEventListener?.('change', onResize);
            header.removeAttribute('data-cmx-folded');
            header.removeAttribute('data-cmx-bar');
            header.style.removeProperty('--cmx-fold');
            nav.removeAttribute('data-cmx-expanded');
            nav.style.removeProperty('--cmx-hbar-bg');
            root.style.removeProperty('--cmx-pin-top');
            shifts.forEach((_, row) => {
                row.style.removeProperty('--cmx-pin-shift');
                row.classList.remove('cmx-pin--anim');
            });
            unfoldRef.current = null;
        };
    }, [navRef, collapse, photos]);

    // The menu opening brings the logo row back (its toggle lives there).
    useEffect(() => {
        if (paused) unfoldRef.current?.();
    }, [paused]);
};
