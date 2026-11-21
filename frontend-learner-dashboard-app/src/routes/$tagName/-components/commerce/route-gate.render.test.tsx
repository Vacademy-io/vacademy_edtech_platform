// @vitest-environment jsdom
/**
 * The hosted-site routes' shop gate: an address that is not a shop route renders its old page
 * at once, a site without a shop renders the old page, and the buying routes answer only when
 * the shop's checkout is switched on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const catalogue = vi.hoisted(() => ({ calls: 0, settings: null as unknown, fail: false }));

vi.mock('../../-services/course-catalogue-service', () => ({
    CourseCatalogueService: {
        getCourseCatalogueByTagMemo: async () => {
            catalogue.calls += 1;
            if (catalogue.fail) throw new Error('offline');
            return { globalSettings: catalogue.settings, pages: [] };
        },
    },
}));
vi.mock('@/components/core/dashboard-loader', () => ({ DashboardLoader: () => <p>loading</p> }));
vi.mock('./entry', () => ({ CommerceRoutePage: ({ route }: { route: { kind: string } }) => <p>shop:{route.kind}</p> }));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommerceRouteGate } from './route-gate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'b2'.repeat(24)}`;
let root: Root | null = null;
let container: HTMLDivElement;

const render = async (segments: string[]) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceRouteGate instituteId="inst-1" tagName="shop" segments={segments} fallback={<p>old page</p>} />
            </QueryClientProvider>
        );
    });
};

const settle = async (until: () => boolean, tries = 50) => {
    for (let i = 0; i < tries && !until(); i += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    }
    expect(until()).toBe(true);
};
const text = () => container.textContent || '';

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    catalogue.calls = 0;
    catalogue.settings = null;
    catalogue.fail = false;
});

describe('CommerceRouteGate', () => {
    it('an address that is no shop route renders the old page at once and reads nothing', async () => {
        await render(['about']);
        expect(text()).toBe('old page');
        expect(catalogue.calls).toBe(0);
    });

    it('a site without a shop gets the old page for every shop-shaped address', async () => {
        catalogue.settings = { layout: {} };
        for (const segments of [['p', 'red-saree'], ['checkout'], ['account']]) {
            await render(segments);
            await settle(() => text() === 'old page');
            await act(async () => root?.unmount());
            document.body.innerHTML = '';
        }
    });

    it('a failed catalogue read falls back to the old page, never a loader for ever', async () => {
        catalogue.fail = true;
        await render(['p', 'red-saree']);
        // The gate retries once (about a second) before it gives up.
        await settle(() => text() === 'old page', 400);
    });

    it('the buying routes answer only when checkout is switched on', async () => {
        catalogue.settings = { commerce: { enabled: true, publishableKey: KEY, checkout: false } };
        await render(['checkout']);
        await settle(() => text() === 'old page');
        await act(async () => root?.unmount());
        document.body.innerHTML = '';
        await render(['p', 'red-saree']);
        await settle(() => text() === 'shop:product');
        await act(async () => root?.unmount());
        document.body.innerHTML = '';

        catalogue.settings = { commerce: { enabled: true, publishableKey: KEY, checkout: true } };
        for (const [segment, kind] of [['checkout', 'checkout'], ['order', 'order'], ['track-order', 'track'], ['account', 'account']]) {
            await render([segment!]);
            await settle(() => text() === `shop:${kind}`);
            await act(async () => root?.unmount());
            document.body.innerHTML = '';
        }
    });
});
