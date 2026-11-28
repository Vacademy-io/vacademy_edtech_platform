import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { PANEL_STORAGE_KEYS } from '../config';
import { installFakeCaches, type FakeCaches } from './testCaches';

const mocks = vi.hoisted(() => ({
    device: { institute_id: 'inst-a', device_id: 'd', device_secret: 's' } as Record<
        string,
        unknown
    > | null,
    meta: {
        session_id: 's1',
        user_id: 'teacher-a',
        started_at_ms: 0,
        last_refresh_wall_ms: 0,
    } as Record<string, unknown> | null,
    refreshToken: 'tok' as string | null,
    sinceRefresh: 0 as number | null,
    cap: null as number | null,
    reachable: true,
}));

vi.mock('../device/store', () => ({
    readDevice: () => mocks.device,
    readActiveDevice: () => mocks.device,
    readSessionMeta: () => mocks.meta,
}));
vi.mock('../lib/api', () => ({
    getRefreshToken: () => mocks.refreshToken,
    msSinceLastRefresh: () => mocks.sinceRefresh,
    msUntilSessionCap: () => mocks.cap,
}));
vi.mock('../device/syncLoop', () => ({
    getPanelPolicy: () => ({ idle_minutes: 30, session_hours: 4 }),
}));
vi.mock('../device/publicApi', () => ({
    isBackendReachable: () => mocks.reachable,
    subscribeReachability: () => () => undefined,
    isOfflineFailure: (error: { kind?: string }) => error?.kind === 'offline',
}));

function networkError(status?: number): AxiosError {
    const error = new AxiosError('failed');
    if (status) {
        error.response = {
            status,
            data: {},
            statusText: '',
            headers: {},
            config: { headers: new AxiosHeaders() },
        };
    }
    return error;
}

const MB = 1024 * 1024;

describe('offline layer', () => {
    let fake: FakeCaches;

    beforeEach(() => {
        vi.resetModules();
        window.localStorage.clear();
        fake = installFakeCaches();
        mocks.device = { institute_id: 'inst-a', device_id: 'd', device_secret: 's' };
        mocks.meta = {
            session_id: 's1',
            user_id: 'teacher-a',
            started_at_ms: Date.now(),
            last_refresh_wall_ms: Date.now(),
        };
        mocks.refreshToken = 'tok';
        mocks.sinceRefresh = 0;
        mocks.cap = null;
        mocks.reachable = true;
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: { estimate: async () => ({ quota: 1000 * MB, usage: 0 }) },
        });
    });

    async function store() {
        return import('./cacheStore');
    }

    function plan(size: number) {
        return {
            produce: async () => new Response('x'),
            knownSize: size,
        };
    }

    describe('cache names', () => {
        it('files are per institute, lists per institute and teacher', async () => {
            const { filesCacheName, userCacheName } = await store();
            expect(filesCacheName()).toBe('panel-files-inst-a');
            expect(userCacheName()).toBe('panel-user-inst-a-teacher-a');
            mocks.meta = { ...mocks.meta, user_id: 'teacher-b' };
            expect(userCacheName()).toBe('panel-user-inst-a-teacher-b');
            expect(filesCacheName()).toBe('panel-files-inst-a');
        });

        it('no session means no list namespace at all', async () => {
            const { userCacheName } = await store();
            mocks.refreshToken = null;
            expect(userCacheName()).toBeNull();
            mocks.refreshToken = 'tok';
            mocks.meta = null;
            expect(userCacheName()).toBeNull();
        });
    });

    describe('budget', () => {
        it('is 40% of a small quota and capped at 300 MB', async () => {
            let { getBudgetBytes } = await store();
            expect(await getBudgetBytes()).toBe(300 * MB);
            vi.resetModules();
            Object.defineProperty(navigator, 'storage', {
                configurable: true,
                value: { estimate: async () => ({ quota: 100 * MB }) },
            });
            ({ getBudgetBytes } = await store());
            expect(await getBudgetBytes()).toBe(40 * MB);
        });

        it('falls back when estimate is missing', async () => {
            Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
            const { getBudgetBytes } = await store();
            expect(await getBudgetBytes()).toBe(100 * MB);
        });

        it('evicts the least recently used entry, and a read counts as use', async () => {
            Object.defineProperty(navigator, 'storage', {
                configurable: true,
                value: { estimate: async () => ({ quota: 200 * MB }) },
            });
            const { readEntry, writeEntry } = await store();
            await writeEntry('panel-files-inst-a', 'one', plan(30 * MB));
            await writeEntry('panel-files-inst-a', 'two', plan(30 * MB));
            await readEntry('panel-files-inst-a', 'one');
            expect(await writeEntry('panel-files-inst-a', 'three', plan(30 * MB))).toBe('saved');
            expect(await readEntry('panel-files-inst-a', 'two')).toBeNull();
            expect(await readEntry('panel-files-inst-a', 'one')).not.toBeNull();
            expect(await readEntry('panel-files-inst-a', 'three')).not.toBeNull();
        });

        it('skips anything over 50 MB', async () => {
            const { readEntry, writeEntry } = await store();
            expect(await writeEntry('panel-files-inst-a', 'huge', plan(51 * MB))).toBe('skipped');
            expect(await readEntry('panel-files-inst-a', 'huge')).toBeNull();
        });

        it('measures a body with no declared size, and drops it when too big', async () => {
            const { readEntry, writeEntry } = await store();
            const result = await writeEntry('panel-files-inst-a', 'tiny', {
                produce: async () => new Response('abcdef'),
                maxBytes: 3,
            });
            expect(result).toBe('skipped');
            expect(await readEntry('panel-files-inst-a', 'tiny')).toBeNull();
        });
    });

    describe('failed writes never surface', () => {
        it('QuotaExceededError evicts and retries once', async () => {
            const { readEntry, writeEntry } = await store();
            await writeEntry('panel-files-inst-a', 'old', plan(10 * MB));
            fake.refusePuts = 1;
            expect(await writeEntry('panel-files-inst-a', 'new', plan(5 * MB))).toBe('saved');
            expect(await readEntry('panel-files-inst-a', 'new')).not.toBeNull();
        });

        it('a second refusal is skipped, without throwing', async () => {
            const { readEntry, writeEntry } = await store();
            fake.refusePuts = 2;
            expect(await writeEntry('panel-files-inst-a', 'new', plan(5 * MB))).toBe('skipped');
            expect(fake.puts).toBe(2);
            expect(await readEntry('panel-files-inst-a', 'new')).toBeNull();
        });

        it('a failed fetch is reported as failed so the caller may retry', async () => {
            const { writeEntry } = await store();
            const result = await writeEntry('panel-files-inst-a', 'k', {
                produce: () => Promise.reject(new TypeError('network')),
            });
            expect(result).toBe('failed');
        });
    });

    describe('wipe', () => {
        it('removes every namespace, the index and the resume record', async () => {
            const { writeEntry } = await store();
            const { wipeOfflineData } = await import('./wipe');
            await writeEntry('panel-files-inst-a', 'one', plan(1));
            await writeEntry('panel-user-inst-a-teacher-a', 'two', plan(1));
            fake.store.set('someone-elses-cache', new Map());
            window.localStorage.setItem(PANEL_STORAGE_KEYS.resume, '{}');
            await wipeOfflineData();
            expect(Array.from(fake.store.keys())).toEqual(['someone-elses-cache']);
            expect(window.localStorage.getItem(PANEL_STORAGE_KEYS.offlineIndex)).toBeNull();
            expect(window.localStorage.getItem(PANEL_STORAGE_KEYS.resume)).toBeNull();
            expect(window.localStorage.getItem(PANEL_STORAGE_KEYS.offlineWipe)).toBeNull();
        });

        it('a write in flight during a wipe leaves nothing behind', async () => {
            const { writeEntry } = await store();
            const { wipeOfflineData } = await import('./wipe');
            let release: () => void = () => undefined;
            const started = writeEntry('panel-files-inst-a', 'slow', {
                produce: async () => {
                    await wipeOfflineData();
                    return new Promise<Response>((resolve) => {
                        release = () => resolve(new Response('x'));
                        release();
                    });
                },
            });
            expect(await started).toBe('skipped');
            expect(fake.store.get('panel-files-inst-a')).toBeUndefined();
        });

        it('a write queued before a wipe does not run after it', async () => {
            const { writeEntry } = await store();
            const { getWipeGeneration, wipeOfflineData } = await import('./wipe');
            const generation = getWipeGeneration();
            await wipeOfflineData();
            const produce = vi.fn(async () => new Response('x'));
            expect(await writeEntry('panel-files-inst-a', 'late', { produce, generation })).toBe(
                'skipped'
            );
            expect(produce).not.toHaveBeenCalled();
            expect(fake.store.get('panel-files-inst-a')).toBeUndefined();
        });

        it('a file copy waiting at the time of a wipe leaves nothing behind', async () => {
            vi.useFakeTimers();
            const fetchMock = vi.fn(
                async () =>
                    new Response('PDF', {
                        status: 200,
                        headers: { 'Content-Type': 'application/pdf', 'Content-Length': '3' },
                    })
            );
            vi.stubGlobal('fetch', fetchMock);
            try {
                const { saveFileCopy } = await import('./fileCache');
                const { wipeOfflineData } = await import('./wipe');
                saveFileCopy('file-waiting', 'https://cdn.example/x');
                await vi.advanceTimersByTimeAsync(1000);
                await wipeOfflineData();
                await vi.advanceTimersByTimeAsync(10000);
                expect(fake.store.get('panel-files-inst-a')).toBeUndefined();
                expect(fetchMock).not.toHaveBeenCalled();
            } finally {
                vi.unstubAllGlobals();
                vi.useRealTimers();
            }
        });

        it('a wipe a restart interrupted finishes at the next boot', async () => {
            const { writeEntry } = await store();
            const { finishInterruptedWipe } = await import('./wipe');
            await writeEntry('panel-files-inst-a', 'one', plan(1));
            window.localStorage.setItem(PANEL_STORAGE_KEYS.offlineWipe, '1');
            finishInterruptedWipe();
            await vi.waitFor(() => expect(fake.store.size).toBe(0));
        });
    });

    describe('reconcile', () => {
        it('drops bytes the index cannot see and index rows with no bytes', async () => {
            const { readEntry, reconcileIndex, writeEntry } = await store();
            await writeEntry('panel-files-inst-a', 'kept', plan(1));
            await writeEntry('panel-files-inst-a', 'gone', plan(1));
            const bucket = fake.store.get('panel-files-inst-a');
            bucket?.delete('/panel-offline/gone');
            bucket?.set('/panel-offline/stray', 'x');
            await reconcileIndex();
            expect(await readEntry('panel-files-inst-a', 'stray')).toBeNull();
            expect(await readEntry('panel-files-inst-a', 'kept')).not.toBeNull();
            const index = JSON.parse(
                window.localStorage.getItem(PANEL_STORAGE_KEYS.offlineIndex) ?? '{}'
            );
            expect(Object.keys(index.entries).length).toBe(1);
        });

        it('an index started before pairing does not wipe what was saved after it', async () => {
            const device = mocks.device;
            mocks.device = null;
            const { reconcileIndex, writeEntry } = await store();
            await reconcileIndex();
            mocks.device = device;
            await writeEntry('panel-files-inst-a', 'one', plan(1));
            vi.resetModules();
            const fresh = await store();
            await fresh.reconcileIndex();
            expect(await fresh.readEntry('panel-files-inst-a', 'one')).not.toBeNull();
        });

        it('a different institute from the index wipes everything', async () => {
            const { reconcileIndex, writeEntry } = await store();
            await writeEntry('panel-files-inst-a', 'one', plan(1));
            mocks.device = { institute_id: 'inst-b', device_id: 'd', device_secret: 's' };
            await reconcileIndex();
            expect(fake.store.size).toBe(0);
        });
    });

    describe('networkFirst', () => {
        async function nf() {
            return import('./networkFirst');
        }

        async function savedList() {
            const { networkFirst } = await nf();
            await networkFirst('list', async () => ['saved']);
            await vi.waitFor(
                () =>
                    expect(
                        fake.store.get('panel-user-inst-a-teacher-a')?.has('/panel-offline/list')
                    ).toBe(true),
                { timeout: 3000 }
            );
        }

        it('saves a good answer and falls back to it on a network failure', async () => {
            await savedList();
            const { networkFirst } = await nf();
            await expect(
                networkFirst('list', () => Promise.reject(networkError()))
            ).resolves.toEqual(['saved']);
            const { isShowingSaved } = await import('./savedCopy');
            expect(isShowingSaved('list')).toBe(true);
        });

        it('a 503 falls back too', async () => {
            await savedList();
            const { networkFirst } = await nf();
            await expect(
                networkFirst('list', () => Promise.reject(networkError(503)))
            ).resolves.toEqual(['saved']);
        });

        it('a refusal is never answered from the saved copy', async () => {
            await savedList();
            const { networkFirst } = await nf();
            await expect(
                networkFirst('list', () => Promise.reject(networkError(403)))
            ).rejects.toBeTruthy();
            await expect(
                networkFirst('list', () => Promise.reject(networkError(510)))
            ).rejects.toBeTruthy();
        });

        it('another teacher cannot reach the saved copy', async () => {
            await savedList();
            mocks.meta = { ...mocks.meta, user_id: 'teacher-b' };
            const { networkFirst } = await nf();
            await expect(
                networkFirst('list', () => Promise.reject(networkError()))
            ).rejects.toBeTruthy();
        });

        it('with no session it only ever asks the network', async () => {
            mocks.refreshToken = null;
            const { networkFirst } = await nf();
            await expect(networkFirst('list', async () => ['live'])).resolves.toEqual(['live']);
            expect(fake.store.size).toBe(0);
        });

        it('past the offline limit the saved copy stays shut', async () => {
            await savedList();
            mocks.sinceRefresh = 61 * 60 * 1000;
            const { networkFirst } = await nf();
            await expect(
                networkFirst('list', () => Promise.reject(networkError()))
            ).rejects.toBeTruthy();
        });

        it('a partial answer is not saved, and a whole saved copy beats it', async () => {
            await savedList();
            const { networkFirst } = await nf();
            const partial = () => true;
            await expect(
                networkFirst('list', async () => ['part'], { isPartial: partial })
            ).resolves.toEqual(['saved']);
            await expect(
                networkFirst('other', async () => ['part'], { isPartial: partial })
            ).resolves.toEqual(['part']);
            await new Promise((resolve) => setTimeout(resolve, 1700));
            expect(fake.store.get('panel-user-inst-a-teacher-a')?.has('/panel-offline/other')).toBe(
                false
            );
        });

        it('a network that hangs yields the saved copy; with none it keeps waiting', async () => {
            await savedList();
            const { networkFirst } = await nf();
            const never = () => new Promise<string[]>(() => undefined);
            await expect(networkFirst('list', never, { slowMs: 20 })).resolves.toEqual(['saved']);
            let settled = false;
            void networkFirst('nothing-saved', never, { slowMs: 20 }).then(() => {
                settled = true;
            });
            await new Promise((resolve) => setTimeout(resolve, 80));
            expect(settled).toBe(false);
        });
    });

    describe('offline limit', () => {
        async function lock() {
            return import('./lock');
        }
        const HOUR = 60 * 60 * 1000;

        it('runs on the monotonic timer once this boot has refreshed', async () => {
            const { offlineUseExpired } = await lock();
            mocks.sinceRefresh = 59 * 60 * 1000;
            expect(offlineUseExpired()).toBe(false);
            mocks.sinceRefresh = HOUR;
            expect(offlineUseExpired()).toBe(true);
        });

        it('within one boot, time the monotonic timer missed still counts', async () => {
            const { offlineUseExpired } = await lock();
            const now = Date.now();
            mocks.sinceRefresh = 5 * 60 * 1000;
            mocks.meta = {
                ...mocks.meta,
                last_refresh_wall_ms: now - 16 * HOUR,
                started_at_ms: now - 16 * HOUR,
            };
            expect(offlineUseExpired(now)).toBe(true);
        });

        it('within one boot, a clock that has gone backwards does not lock', async () => {
            const { offlineUseExpired } = await lock();
            const now = Date.now();
            mocks.sinceRefresh = 5 * 60 * 1000;
            mocks.meta = {
                ...mocks.meta,
                last_refresh_wall_ms: now + 100 * HOUR,
                started_at_ms: now + 100 * HOUR,
            };
            expect(offlineUseExpired(now)).toBe(false);
        });

        it('stops at the last known session limit', async () => {
            const { offlineUseExpired } = await lock();
            mocks.cap = 1000;
            expect(offlineUseExpired()).toBe(false);
            mocks.cap = 0;
            expect(offlineUseExpired()).toBe(true);
        });

        it('after a restart the wall-clock gap counts', async () => {
            const { offlineUseExpired } = await lock();
            mocks.sinceRefresh = null;
            const now = Date.now();
            mocks.meta = { ...mocks.meta, last_refresh_wall_ms: now - 10 * 60 * 1000 };
            expect(offlineUseExpired(now)).toBe(false);
            mocks.meta = { ...mocks.meta, last_refresh_wall_ms: now - 2 * HOUR };
            expect(offlineUseExpired(now)).toBe(true);
        });

        it('a clock that has gone backwards does not lock', async () => {
            const { offlineUseExpired } = await lock();
            mocks.sinceRefresh = null;
            const now = Date.now();
            mocks.meta = {
                ...mocks.meta,
                last_refresh_wall_ms: now + 100 * HOUR,
                started_at_ms: now + 100 * HOUR,
            };
            expect(offlineUseExpired(now)).toBe(false);
        });

        it('after a restart the session limit counts by the wall clock too', async () => {
            const { offlineUseExpired } = await lock();
            mocks.sinceRefresh = null;
            const now = Date.now();
            mocks.meta = {
                ...mocks.meta,
                last_refresh_wall_ms: now - 60 * 1000,
                started_at_ms: now - 5 * HOUR,
            };
            expect(offlineUseExpired(now)).toBe(true);
        });
    });
});
