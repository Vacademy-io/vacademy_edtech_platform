// @vitest-environment jsdom
/**
 * Scroll and focus between shop pages (useShopScroll), in jsdom with the window's scroll
 * stubbed: a tapped page opens at the top with focus on its main region, Back returns to the
 * remembered offset of the listing, and a filter change on the same page moves nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ location: { pathname: '/c/sarees', searchStr: '' } }));

vi.mock('@tanstack/react-router', () => ({
    useLocation: (opts?: { select?: (location: unknown) => unknown }) => (opts?.select ? opts.select(router.location) : router.location),
    useRouter: () => ({ history: { location: router.location } }),
}));
vi.mock('./site', () => ({ useCommerceSite: () => ({ config: { theme: { displayFont: '', textFont: '' } } }) }));

import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useShopScroll } from './hooks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Page: React.FC<{ pageId: string }> = ({ pageId }) => {
    const main = useRef<HTMLElement>(null);
    useShopScroll(pageId, main);
    return (
        <main id="catalogue-main" tabIndex={-1} ref={main}>
            {pageId}
        </main>
    );
};

let root: Root;
let scrolledTo: number[];
let scrollY = 0;

const show = async (pageId: string, pathname: string, searchStr = '') => {
    router.location = { pathname, searchStr };
    await act(async () => {
        root.render(<Page pageId={pageId} />);
    });
};

/** The shopper scrolls: the browser reports the offset and fires scroll. */
const scrollBy = async (y: number) => {
    scrollY = y;
    await act(async () => {
        window.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => setTimeout(resolve, 40));
    });
};

beforeEach(() => {
    scrolledTo = [];
    scrollY = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 5000 });
    window.scrollTo = ((_x: number, y: number) => {
        scrolledTo.push(y);
        scrollY = y;
    }) as typeof window.scrollTo;
    window.sessionStorage.clear();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
});

describe('scroll between shop pages', () => {
    it('opens a tapped product at the top, focuses its content, and returns to the listing offset on Back', async () => {
        await show('collection:sarees', '/c/sarees');
        await scrollBy(1840);
        scrolledTo.length = 0;

        // A tap on a card (a click, then the new page).
        await act(async () => {
            document.body.click();
        });
        await show('product:red-saree', '/p/red-saree');
        expect(scrolledTo).toEqual([0]);
        expect(document.activeElement?.id).toBe('catalogue-main');

        // Back: popstate, then the listing again.
        scrolledTo.length = 0;
        await act(async () => {
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await show('collection:sarees', '/c/sarees');
        expect(scrolledTo).toEqual([1840]);
    });

    it('does not move the page when only the filters change', async () => {
        await show('collection:sarees', '/c/sarees');
        await scrollBy(700);
        scrolledTo.length = 0;
        await show('collection:sarees', '/c/sarees', '?filter.colour=red');
        expect(scrolledTo).toEqual([]);
        // The filtered view remembers its own offset from here on.
        await scrollBy(300);
        await act(async () => root.unmount());
        const stored = JSON.parse(window.sessionStorage.getItem('commerce-scroll') || '{}');
        expect(stored).toMatchObject({ '/c/sarees': 700, '/c/sarees?filter.colour=red': 300 });
        root = createRoot(document.body.appendChild(document.createElement('div')));
    });

    it('opens a page at the top on Back when nothing was remembered for it', async () => {
        await show('product:red-saree', '/p/red-saree');
        await scrollBy(400);
        scrolledTo.length = 0;
        await act(async () => {
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await show('collection:never-seen', '/c/never-seen');
        expect(scrolledTo).toEqual([0]);
    });
});
