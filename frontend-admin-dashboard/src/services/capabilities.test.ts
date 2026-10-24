import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node's unconfigured Web Storage global shadows happy-dom's, leaving
// `localStorage` undefined in this environment — install an in-memory one.
const h = vi.hoisted(() => {
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
    return {
        store,
        get: vi.fn(),
        instituteId: 'inst-1' as string | undefined,
        roleKey: 'ADMIN_DISPLAY_SETTINGS',
        cached: null as unknown,
        clearCache: vi.fn(),
        refetch: vi.fn(),
    };
});

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: h.get } }));
vi.mock('@/lib/auth/instituteUtils', () => ({
    getCurrentInstituteId: () => h.instituteId,
    getActiveRoleDisplaySettingsKey: () => h.roleKey,
}));
vi.mock('@/services/display-settings', () => ({
    clearDisplaySettingsCache: h.clearCache,
    getDisplaySettings: h.refetch,
    getDisplaySettingsFromCache: () => h.cached,
}));

type CapabilitiesModule = typeof import('./capabilities');

/** Fresh module per test: the once-per-session guard is module state. */
const load = async (): Promise<CapabilitiesModule> => {
    vi.resetModules();
    return import('./capabilities');
};

const me = (over: Record<string, unknown> = {}) => ({
    mode: 'LEGACY',
    catalog_version: 1,
    modules: { crm: true },
    features: { 'crm.leads': true, 'crm.ai_calling': false },
    display_settings_version: 'v2',
    ...over,
});

beforeEach(() => {
    h.store.clear();
    h.get.mockReset();
    h.clearCache.mockReset();
    h.refetch.mockReset().mockResolvedValue({});
    h.instituteId = 'inst-1';
    h.roleKey = 'ADMIN_DISPLAY_SETTINGS';
    h.cached = { sidebar: [] };
});

describe('shouldBustDisplaySettingsCache', () => {
    it('busts when the server version differs from the stored one', async () => {
        const { shouldBustDisplaySettingsCache: bust } = await load();
        expect(bust({ serverVersion: 'v2', storedVersion: 'v1', hasCachedSettings: true })).toBe(
            true
        );
    });

    it('keeps the cache when the versions match', async () => {
        const { shouldBustDisplaySettingsCache: bust } = await load();
        expect(bust({ serverVersion: 'v2', storedVersion: 'v2', hasCachedSettings: true })).toBe(
            false
        );
    });

    it('refreshes once a cache recorded before versions existed', async () => {
        const { shouldBustDisplaySettingsCache: bust } = await load();
        expect(bust({ serverVersion: 'v2', storedVersion: null, hasCachedSettings: true })).toBe(
            true
        );
    });

    it('never busts without a server version or without a cache', async () => {
        const { shouldBustDisplaySettingsCache: bust } = await load();
        expect(bust({ serverVersion: null, storedVersion: 'v1', hasCachedSettings: true })).toBe(
            false
        );
        expect(bust({ serverVersion: 'v2', storedVersion: 'v1', hasCachedSettings: false })).toBe(
            false
        );
    });
});

describe('resolveCan', () => {
    const loaded = (mode: 'LEGACY' | 'MANAGED') => ({
        instituteId: 'inst-1',
        status: 'loaded' as const,
        data: {
            mode,
            catalog_version: 1,
            modules: {},
            features: { 'crm.leads': true, 'crm.ai_calling': false },
            display_settings_version: 'v1',
        },
    });

    it('is open in LEGACY mode, even for a feature reported off', async () => {
        const { resolveCan } = await load();
        expect(resolveCan(loaded('LEGACY'), 'inst-1', 'crm.ai_calling')).toBe(true);
    });

    it('is open before load and after an error', async () => {
        const { resolveCan } = await load();
        const base = { instituteId: 'inst-1', data: null };
        expect(resolveCan({ ...base, status: 'idle' }, 'inst-1', 'crm.ai_calling')).toBe(true);
        expect(resolveCan({ ...base, status: 'loading' }, 'inst-1', 'crm.ai_calling')).toBe(true);
        expect(resolveCan({ ...base, status: 'error' }, 'inst-1', 'crm.ai_calling')).toBe(true);
    });

    it('in MANAGED mode hides only what the server reports off', async () => {
        const { resolveCan } = await load();
        expect(resolveCan(loaded('MANAGED'), 'inst-1', 'crm.leads')).toBe(true);
        expect(resolveCan(loaded('MANAGED'), 'inst-1', 'crm.ai_calling')).toBe(false);
        // Unknown key: fail open, the server enforces.
        expect(resolveCan(loaded('MANAGED'), 'inst-1', 'not.in.catalog')).toBe(true);
    });

    it('ignores capabilities loaded for another institute', async () => {
        const { resolveCan } = await load();
        expect(resolveCan(loaded('MANAGED'), 'inst-2', 'crm.ai_calling')).toBe(true);
    });
});

describe('normalizeCapabilitiesMe', () => {
    it('rejects a non-JSON body and treats an unknown mode as LEGACY', async () => {
        const { normalizeCapabilitiesMe } = await load();
        expect(normalizeCapabilitiesMe('<!doctype html>')).toBeNull();
        expect(normalizeCapabilitiesMe(me({ mode: 'SOMETHING' }))?.mode).toBe('LEGACY');
        expect(normalizeCapabilitiesMe(me({ display_settings_version: null }))).toMatchObject({
            display_settings_version: null,
        });
    });
});

describe('syncCapabilitiesOnce', () => {
    it('busts and refetches the active role when the version moved', async () => {
        const m = await load();
        h.store.set('DISPLAY_SETTINGS_SERVER_VERSION-inst-1', 'v1');
        h.get.mockResolvedValue({ data: me() });

        await m.syncCapabilitiesOnce('inst-1');

        expect(h.get).toHaveBeenCalledWith(expect.stringContaining('/capabilities/v1/me'), {
            params: { instituteId: 'inst-1' },
        });
        expect(h.clearCache).toHaveBeenCalledWith();
        expect(h.clearCache).toHaveBeenCalledWith('ADMIN_DISPLAY_SETTINGS');
        expect(h.refetch).toHaveBeenCalledWith('ADMIN_DISPLAY_SETTINGS', true);
        expect(h.store.get('DISPLAY_SETTINGS_SERVER_VERSION-inst-1')).toBe('v2');
        expect(m.useCapabilitiesStore.getState()).toMatchObject({
            instituteId: 'inst-1',
            status: 'loaded',
        });
    });

    it('leaves a current cache alone', async () => {
        const m = await load();
        h.store.set('DISPLAY_SETTINGS_SERVER_VERSION-inst-1', 'v2');
        h.get.mockResolvedValue({ data: me() });

        await m.syncCapabilitiesOnce('inst-1');

        expect(h.clearCache).not.toHaveBeenCalled();
        expect(h.refetch).not.toHaveBeenCalled();
    });

    it('calls the endpoint only once per session per institute', async () => {
        const m = await load();
        h.get.mockResolvedValue({ data: me() });

        await Promise.all([m.syncCapabilitiesOnce('inst-1'), m.syncCapabilitiesOnce('inst-1')]);
        await m.syncCapabilitiesOnce('inst-1');

        expect(h.get).toHaveBeenCalledTimes(1);
    });

    it('degrades silently on 404: no bust, can() stays open', async () => {
        const m = await load();
        h.store.set('DISPLAY_SETTINGS_SERVER_VERSION-inst-1', 'v1');
        h.get.mockRejectedValue(
            Object.assign(new Error('Not Found'), { response: { status: 404 } })
        );

        await expect(m.syncCapabilitiesOnce('inst-1')).resolves.toBeUndefined();

        expect(h.clearCache).not.toHaveBeenCalled();
        expect(h.refetch).not.toHaveBeenCalled();
        const snapshot = m.useCapabilitiesStore.getState();
        expect(snapshot.status).toBe('error');
        expect(m.resolveCan(snapshot, 'inst-1', 'crm.ai_calling')).toBe(true);
    });

    it('swallows a failed refetch after busting', async () => {
        const m = await load();
        h.get.mockResolvedValue({ data: me() });
        h.refetch.mockRejectedValue(new Error('network'));

        await expect(m.syncCapabilitiesOnce('inst-1')).resolves.toBeUndefined();
        expect(h.clearCache).toHaveBeenCalled();
    });

    it('does not touch the cache when the user switched institute meanwhile', async () => {
        const m = await load();
        h.instituteId = 'inst-2';
        h.get.mockResolvedValue({ data: me() });

        await m.syncCapabilitiesOnce('inst-1');

        expect(h.clearCache).not.toHaveBeenCalled();
        expect(h.store.has('DISPLAY_SETTINGS_SERVER_VERSION-inst-1')).toBe(false);
    });
});
