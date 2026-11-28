// @vitest-environment jsdom
/**
 * One category bar only: a fixed shop page keeps its in-page tab row unless the site's header
 * carries the bar on that page (commerce.categoryBar). The site chrome is stubbed; the page offset
 * it is asked for is checked through the pageKey it receives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ location: { pathname: '/shop/c/sarees', search: '', hash: '', searchStr: '' }, chrome: [] as Array<string | undefined> }));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({ history: { location: router.location, replace: () => undefined }, navigate: () => Promise.resolve(), latestLocation: { search: {} } }),
    useNavigate: () => () => Promise.resolve(),
    useLocation: (opts?: { select?: (location: unknown) => unknown }) => (opts?.select ? opts.select(router.location) : router.location),
    useParams: () => ({}),
}));
vi.mock('../../CatalogueChrome', () => ({
    CatalogueChrome: ({ children, pageKey }: { children: React.ReactNode; pageKey?: string }) => {
        router.chrome.push(pageKey);
        return children;
    },
}));
vi.mock('../../../-utils/catalogue-tracking', () => ({ useCatalogueTracking: () => undefined }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommerceRoutePage } from '../entry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const TREE = [{ slug: 'sarees', kind: 'CATEGORY', name: 'साड़ियाँ', description: null, image_url: null, path: '/c/sarees', position: 0, product_count: 9, in_stock_count: 9, children: [] }];
const LIST = { data: [], total: 0, page: 1, page_size: 24, has_more: false, locale: 'hi', facets: null };
const site = (extra: Record<string, unknown> = {}) => ({
    layout: { header: { enabled: true, type: 'header', props: {} } },
    commerce: { enabled: true, publishableKey: KEY, ...extra },
});

let root: Root | null = null;
let container: HTMLDivElement;
const render = async (globalSettings: unknown, route: React.ComponentProps<typeof CommerceRoutePage>['route']) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <CommerceRoutePage instituteId="inst-1" tagName="shop" globalSettings={globalSettings} route={route} />
            </QueryClientProvider>
        );
    });
    for (let i = 0; i < 20; i += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    }
};

beforeEach(() => {
    router.chrome.length = 0;
    vi.stubGlobal('scrollTo', () => undefined);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/catalog/v1/categories')) return json({ data: TREE, locale: 'hi' });
        if (url.pathname.endsWith('/catalog/v1/products')) return json(LIST);
        return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    });
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('one category bar on a fixed shop page', () => {
    it('keeps the in-page tab row on a shop without the header bar', async () => {
        await render(site(), { kind: 'collection', slug: 'sarees' });
        expect(container.querySelector('nav.cmx-catbar')).not.toBeNull();
        expect(router.chrome).toContain('collection');
    });

    it('drops it where the header carries the bar, and keeps it where the site left the bar off', async () => {
        const bar = { categoryBar: { enabled: true, pages: ['collection'] } };
        await render(site(bar), { kind: 'collection', slug: 'sarees' });
        expect(container.querySelector('nav.cmx-catbar')).toBeNull();
        await act(async () => root?.unmount());
        await render(site(bar), { kind: 'cart' });
        expect(container.querySelector('nav.cmx-catbar')).not.toBeNull();
    });

    it('keeps the row on a site with no header of its own (the bar lives in the header)', async () => {
        const settings = { commerce: { enabled: true, publishableKey: KEY, categoryBar: { enabled: true, pages: ['collection'] } } };
        await render(settings, { kind: 'collection', slug: 'sarees' });
        expect(container.querySelector('nav.cmx-catbar')).not.toBeNull();
    });
});
