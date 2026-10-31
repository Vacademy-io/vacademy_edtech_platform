import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';

const h = vi.hoisted(() => {
    // Node's unconfigured Web Storage global shadows happy-dom's here.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
            setItem: (k: string, v: string) => void store.set(k, String(v)),
            removeItem: (k: string) => void store.delete(k),
            clear: () => store.clear(),
        },
        configurable: true,
        writable: true,
    });
    return { get: vi.fn(), instituteId: 'inst-1' as string | undefined };
});

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: h.get } }));
vi.mock('@/lib/auth/instituteUtils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/auth/instituteUtils')>()),
    getCurrentInstituteId: () => h.instituteId,
}));

import { useCapabilitiesStore } from '@/services/capabilities';
import { CAPABILITIES_CATALOG } from '@/constants/urls';
import { useEntitlement } from './use-entitlement';
import { FULL_ENTITLEMENT } from './entitlement';
import { CATALOG_PATH } from './test-support';

const rawCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

const allFeatures = (on: boolean, except: string[] = []) =>
    Object.fromEntries(
        (rawCatalog.modules as Array<{ features: Array<{ key: string }> }>).flatMap((m) =>
            m.features.map((f) => [f.key, except.includes(f.key) ? !on : on])
        )
    );

function setMe(mode: 'LEGACY' | 'MANAGED', features: Record<string, boolean>) {
    useCapabilitiesStore.setState({
        instituteId: 'inst-1',
        status: 'loaded',
        data: { mode, catalog_version: 1, modules: {}, features, display_settings_version: null },
    });
}

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Let any (wrongly) started request settle inside act(). */
const settle = () =>
    act(async () => {
        await new Promise((r) => setTimeout(r, 20));
    });

const catalogCalls = () => h.get.mock.calls.filter(([url]) => url === CAPABILITIES_CATALOG);

beforeEach(() => {
    h.get.mockReset().mockResolvedValue({ data: { catalog: rawCatalog, nav: null } });
    h.instituteId = 'inst-1';
    useCapabilitiesStore.setState({ instituteId: null, status: 'idle', data: null });
});

describe('useEntitlement', () => {
    it('LEGACY: FULL_ENTITLEMENT and no catalogue request, even with features off', async () => {
        setMe('LEGACY', allFeatures(false));
        const { result } = renderHook(() => useEntitlement(), { wrapper });
        expect(result.current).toBe(FULL_ENTITLEMENT);
        await settle();
        expect(result.current).toBe(FULL_ENTITLEMENT);
        expect(catalogCalls()).toHaveLength(0);
    });

    it('capabilities not loaded / failed: FULL_ENTITLEMENT, no request', async () => {
        useCapabilitiesStore.setState({ instituteId: 'inst-1', status: 'error', data: null });
        const { result } = renderHook(() => useEntitlement(), { wrapper });
        await settle();
        expect(result.current).toBe(FULL_ENTITLEMENT);
        expect(catalogCalls()).toHaveLength(0);
    });

    it('MANAGED for ANOTHER institute: FULL_ENTITLEMENT', async () => {
        setMe('MANAGED', allFeatures(true, ['lms.courses']));
        h.instituteId = 'inst-2';
        const { result } = renderHook(() => useEntitlement(), { wrapper });
        await settle();
        expect(result.current).toBe(FULL_ENTITLEMENT);
        expect(catalogCalls()).toHaveLength(0);
    });

    it('MANAGED: fetches the catalogue once and gates by it', async () => {
        setMe('MANAGED', allFeatures(true, ['lms.courses']));
        const { result } = renderHook(() => useEntitlement(), { wrapper });
        expect(result.current.managed).toBe(false); // fail open until the catalogue is in
        await waitFor(() => expect(result.current.managed).toBe(true));
        expect(result.current.isNavItemEntitled('courses')).toBe(false);
        expect(result.current.isNavItemEntitled('leads')).toBe(true);
        expect(catalogCalls()).toHaveLength(1);
    });

    it('MANAGED but the catalogue fails: FULL_ENTITLEMENT', async () => {
        setMe('MANAGED', allFeatures(true, ['lms.courses']));
        h.get.mockReset().mockRejectedValue(new Error('500'));
        const { result } = renderHook(() => useEntitlement(), { wrapper });
        await waitFor(() => expect(catalogCalls()).toHaveLength(1));
        await settle();
        expect(result.current).toBe(FULL_ENTITLEMENT);
    });

    it('MANAGED but the catalogue body is junk: FULL_ENTITLEMENT', async () => {
        setMe('MANAGED', allFeatures(true, ['lms.courses']));
        h.get.mockReset().mockResolvedValue({ data: '<html>' });
        const { result } = renderHook(() => useEntitlement(), { wrapper });
        await waitFor(() => expect(catalogCalls()).toHaveLength(1));
        await settle();
        expect(result.current).toBe(FULL_ENTITLEMENT);
    });
});
