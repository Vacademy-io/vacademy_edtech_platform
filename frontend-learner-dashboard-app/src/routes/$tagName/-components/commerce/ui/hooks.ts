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

/** Pinch-zoom allowed while a shop root is on screen (logic/viewport.ts). */
export const useZoomableViewport = (): void => {
    useEffect(() => holdZoomableViewport(), []);
};

/* ── header fold (category bar) ───────────────────────────────────── */

/** Below this scroll offset the logo row is always shown. */
const FOLD_MIN_Y = 160;
/** Downward travel since the last turn that folds the logo row. */
const FOLD_DOWN = 12;
/** Upward travel since the last turn that brings it back. */
const FOLD_UP = 24;

/**
 * The fixed site header with the category bar: keeps --cmx-pin-top on <html> at the header's
 * visible bottom (the sticky Filter·Sort bar and anchors read it) and, when `collapse` is on,
 * folds the logo row away on scroll-down on phones and tablets. The fold is a transform on the
 * fixed header, so nothing in the page moves. The bar itself never hides.
 */
export const useHeaderFold = (rowRef: React.RefObject<HTMLElement | null>, collapse: boolean, paused: boolean): void => {
    const pausedRef = useRef(paused);
    const unfoldRef = useRef<(() => void) | null>(null);
    pausedRef.current = paused;

    useEffect(() => {
        const row = rowRef.current;
        const header = row?.closest('header');
        if (!row || !header || typeof window === 'undefined') return;
        const root = document.documentElement;
        const narrow = window.matchMedia ? window.matchMedia('(max-width: 1023.98px)') : null;
        let folded = false;
        let lastY = window.scrollY;
        let anchorY = lastY;
        let direction = 0;
        let frame = 0;

        const apply = (next: boolean) => {
            folded = next;
            const height = header.getBoundingClientRect().height;
            const bar = row.getBoundingClientRect().height;
            header.style.setProperty('--cmx-fold', `${Math.max(0, Math.round(height - bar))}px`);
            header.toggleAttribute('data-cmx-folded', next);
            root.style.setProperty('--cmx-pin-top', `${Math.round(next ? bar : height)}px`);
        };
        const unfold = () => {
            if (folded) apply(false);
        };
        unfoldRef.current = unfold;
        header.setAttribute('data-cmx-bar', '');
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
                if (!canFold() || y < FOLD_MIN_Y) {
                    unfold();
                    anchorY = y;
                    return;
                }
                if (dy === 0) return;
                const turn = dy > 0 ? 1 : -1;
                if (turn !== direction) {
                    direction = turn;
                    anchorY = y - dy;
                }
                if (turn > 0 && !folded && y - anchorY >= FOLD_DOWN) apply(true);
                else if (turn < 0 && folded && anchorY - y >= FOLD_UP) apply(false);
            });
        };
        const onResize = () => apply(folded && canFold());
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize);
        header.addEventListener('focusin', unfold);
        narrow?.addEventListener?.('change', onResize);
        return () => {
            if (frame) cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onResize);
            header.removeEventListener('focusin', unfold);
            narrow?.removeEventListener?.('change', onResize);
            header.removeAttribute('data-cmx-folded');
            header.removeAttribute('data-cmx-bar');
            header.style.removeProperty('--cmx-fold');
            root.style.removeProperty('--cmx-pin-top');
            unfoldRef.current = null;
        };
    }, [rowRef, collapse]);

    // The menu opening brings the logo row back (its toggle lives there).
    useEffect(() => {
        if (paused) unfoldRef.current?.();
    }, [paused]);
};
