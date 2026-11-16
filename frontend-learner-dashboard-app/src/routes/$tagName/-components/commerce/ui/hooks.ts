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
