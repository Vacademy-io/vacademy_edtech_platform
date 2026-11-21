/**
 * The Cache API from page context, with no worker. Two namespaces:
 *
 *   panel-files-<instituteId>            PDFs and scene JSON, keyed by file id, never by
 *                                        signed URL. Shared within the institute.
 *   panel-user-<instituteId>-<userId>    Lesson lists and parsed decks. Decks hold correct
 *                                        answers, so they open only for the same teacher.
 *                                        Kept across sign-out for tomorrow.
 *
 * One least-recently-used index covers both, in localStorage. Last use is a counter, not a
 * time, because a panel's clock can be wrong. Budget: min(300 MB, 40% of the quota).
 *
 * Nothing here ever rejects. A failed write is logged and skipped; a slide must never fail
 * because its copy could not be saved.
 */
import { PANEL_STORAGE_KEYS } from '../config';
import { readDevice, readSessionMeta } from '../device/store';
import { getRefreshToken } from '../lib/api';
import { readJson, writeJson } from '../lib/storage';
import {
    CACHE_PREFIX_FILES,
    CACHE_PREFIX_USER,
    cacheApiAvailable,
    getWipeGeneration,
    listOfflineCacheNames,
    wipeOfflineData,
} from './wipe';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BUDGET_BYTES = 300 * 1024 * 1024;
const QUOTA_SHARE = 0.4;
/** Where storage.estimate() is missing or fails. */
const FALLBACK_BUDGET_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 1500;
/** Freed on a quota refusal when the size of the write is not known. */
const QUOTA_RELIEF_SHARE = 0.2;

interface IndexEntry {
    /** Bytes. */
    s: number;
    /** Last-use counter. */
    u: number;
}

interface CacheIndex {
    institute_id: string | null;
    next: number;
    entries: Record<string, IndexEntry>;
}

function entryId(cacheName: string, key: string): string {
    return `${cacheName}\n${key}`;
}

function splitEntryId(id: string): { cacheName: string; key: string } {
    const at = id.indexOf('\n');
    return { cacheName: id.slice(0, at), key: id.slice(at + 1) };
}

let loaded: CacheIndex | null = null;
let loadedGeneration = -1;

function emptyIndex(): CacheIndex {
    return { institute_id: readDevice()?.institute_id ?? null, next: 1, entries: {} };
}

function getIndex(): CacheIndex {
    if (!loaded || loadedGeneration !== getWipeGeneration()) {
        const stored = readJson<CacheIndex>(PANEL_STORAGE_KEYS.offlineIndex);
        loaded = stored && stored.entries ? stored : emptyIndex();
        loadedGeneration = getWipeGeneration();
    }
    return loaded;
}

function saveIndex(): void {
    const index = getIndex();
    // Loaded before pairing, this is still empty, and a wipe would have reloaded it.
    index.institute_id = index.institute_id ?? readDevice()?.institute_id ?? null;
    writeJson(PANEL_STORAGE_KEYS.offlineIndex, index);
}

function touch(id: string): void {
    const index = getIndex();
    const entry = index.entries[id];
    if (!entry) return;
    entry.u = index.next;
    index.next += 1;
    saveIndex();
}

function totalBytes(): number {
    const { entries } = getIndex();
    return Object.keys(entries).reduce((sum, id) => sum + (entries[id]?.s ?? 0), 0);
}

function oldestFirst(): string[] {
    const { entries } = getIndex();
    return Object.keys(entries).sort((a, b) => (entries[a]?.u ?? 0) - (entries[b]?.u ?? 0));
}

// ------------------------------------------------------------------ names ---

export function filesCacheName(): string | null {
    const instituteId = readDevice()?.institute_id;
    return instituteId ? `${CACHE_PREFIX_FILES}${instituteId}` : null;
}

/** Null with no session: nobody's lists or decks are reachable then. */
export function userCacheName(): string | null {
    const instituteId = readDevice()?.institute_id;
    const userId = readSessionMeta()?.user_id;
    if (!instituteId || !userId || !getRefreshToken()) return null;
    return `${CACHE_PREFIX_USER}${instituteId}-${userId}`;
}

// ----------------------------------------------------------------- budget ---

let budgetKnown: number | null = null;

export async function getBudgetBytes(): Promise<number> {
    if (budgetKnown !== null) return budgetKnown;
    let budget = FALLBACK_BUDGET_BYTES;
    try {
        const estimate = await navigator.storage.estimate();
        if (estimate && typeof estimate.quota === 'number' && estimate.quota > 0) {
            budget = Math.min(MAX_BUDGET_BYTES, Math.floor(estimate.quota * QUOTA_SHARE));
        }
    } catch {
        /* the fallback stands */
    }
    budgetKnown = budget;
    return budget;
}

function isQuotaError(error: unknown): boolean {
    return !!error && (error as { name?: string }).name === 'QuotaExceededError';
}

/** Drops the least recently used entries until `needed` more bytes fit, then trims the count. */
async function makeRoom(needed: number, keep: string | null): Promise<void> {
    const budget = await getBudgetBytes();
    const index = getIndex();
    const order = oldestFirst();
    let total = totalBytes();
    let count = order.length;
    for (const id of order) {
        if (total + needed <= budget && count <= MAX_ENTRIES) break;
        if (id === keep) continue;
        const size = index.entries[id]?.s ?? 0;
        delete index.entries[id];
        total -= size;
        count -= 1;
        const { cacheName, key } = splitEntryId(id);
        try {
            const cache = await window.caches.open(cacheName);
            await cache.delete(cacheUrl(key));
        } catch (error) {
            console.warn('[panel/offline] eviction failed', error);
        }
    }
    saveIndex();
}

// ----------------------------------------------------------- reads, writes ---

function cacheUrl(key: string): string {
    return `/panel-offline/${encodeURIComponent(key)}`;
}

/** A copy of the entry, or null. Counts as a use. */
export async function readEntry(cacheName: string, key: string): Promise<Response | null> {
    if (!cacheApiAvailable()) return null;
    try {
        const cache = await window.caches.open(cacheName);
        const found = await cache.match(cacheUrl(key));
        if (!found) return null;
        touch(entryId(cacheName, key));
        return found;
    } catch (error) {
        console.warn('[panel/offline] read failed', error);
        return null;
    }
}

export async function removeEntry(cacheName: string, key: string): Promise<void> {
    if (!cacheApiAvailable()) return;
    try {
        const cache = await window.caches.open(cacheName);
        await cache.delete(cacheUrl(key));
    } catch (error) {
        console.warn('[panel/offline] delete failed', error);
    }
    const index = getIndex();
    if (index.entries[entryId(cacheName, key)]) {
        delete index.entries[entryId(cacheName, key)];
        saveIndex();
    }
}

interface WritePlan {
    /** A new response each time: a refused write is tried once more. */
    produce: () => Promise<Response>;
    knownSize?: number;
    maxBytes?: number;
    /**
     * getWipeGeneration() when the write was asked for, which can be well before it runs.
     * Defaults to the one when writeEntry is called.
     */
    generation?: number;
}

/** One write at a time, so eviction and the index never race. */
let writeQueue: Promise<unknown> = Promise.resolve();

/** skipped: not worth another try (too big, no room, wiped). failed: no bytes to write. */
export type WriteResult = 'saved' | 'skipped' | 'failed';

export function writeEntry(cacheName: string, key: string, plan: WritePlan): Promise<WriteResult> {
    const generation = plan.generation ?? getWipeGeneration();
    const run = writeQueue.then(() => doWrite(cacheName, key, plan, generation));
    writeQueue = run;
    return run;
}

function declaredSize(response: Response): number | null {
    const raw = response.headers.get('Content-Length');
    const size = raw ? parseInt(raw, 10) : NaN;
    return isNaN(size) ? null : size;
}

async function doWrite(
    cacheName: string,
    key: string,
    plan: WritePlan,
    generation: number
): Promise<WriteResult> {
    if (!cacheApiAvailable()) return 'skipped';
    // A wipe ran after this write was asked for: it belongs to data that is gone.
    if (generation !== getWipeGeneration()) return 'skipped';
    const maxBytes = plan.maxBytes ?? MAX_FILE_BYTES;
    const id = entryId(cacheName, key);
    const url = cacheUrl(key);
    let response: Response;
    try {
        response = await plan.produce();
    } catch (error) {
        console.warn('[panel/offline] nothing to save', key, error);
        return 'failed';
    }
    try {
        const declared = plan.knownSize ?? declaredSize(response);
        if (declared !== null && declared > maxBytes) {
            void response.body?.cancel();
            return 'skipped';
        }
        const cache = await window.caches.open(cacheName);
        await makeRoom(declared ?? 0, id);
        try {
            await cache.put(url, response);
        } catch (error) {
            if (!isQuotaError(error)) throw error;
            await makeRoom(declared ?? Math.floor(totalBytes() * QUOTA_RELIEF_SHARE), id);
            await cache.put(url, await plan.produce());
        }
        if (generation !== getWipeGeneration()) {
            await window.caches.delete(cacheName);
            return 'skipped';
        }
        let size = declared;
        if (size === null) {
            const stored = await cache.match(url);
            size = stored ? (await stored.blob()).size : 0;
        }
        if (size > maxBytes) {
            await cache.delete(url);
            return 'skipped';
        }
        const index = getIndex();
        index.entries[id] = { s: size, u: index.next };
        index.next += 1;
        saveIndex();
        // An undeclared size is only known now, so this can be the first time it does not fit.
        if (declared === null) await makeRoom(0, id);
        return 'saved';
    } catch (error) {
        console.warn('[panel/offline] write skipped', key, error);
        return 'skipped';
    }
}

// ------------------------------------------------------------- reconcile ---

/**
 * Makes the index and the caches agree, once per boot. A restart between a write and its
 * index update leaves bytes the budget cannot see, and a paired panel whose institute no
 * longer matches the index was re-paired while a wipe could not run.
 */
export async function reconcileIndex(): Promise<void> {
    if (!cacheApiAvailable()) return;
    try {
        const index = getIndex();
        const instituteId = readDevice()?.institute_id ?? null;
        if (index.institute_id && index.institute_id !== instituteId) {
            await wipeOfflineData();
            return;
        }
        const generation = getWipeGeneration();
        const seen = new Set<string>();
        const names = await listOfflineCacheNames();
        for (const name of names) {
            const cache = await window.caches.open(name);
            const requests = await cache.keys();
            for (const request of requests) {
                const encoded = request.url.slice(request.url.lastIndexOf('/') + 1);
                const id = entryId(name, decodeURIComponent(encoded));
                if (index.entries[id]) seen.add(id);
                else await cache.delete(request);
            }
        }
        if (generation !== getWipeGeneration()) return;
        let changed = false;
        Object.keys(index.entries).forEach((id) => {
            if (!seen.has(id)) {
                delete index.entries[id];
                changed = true;
            }
        });
        if (changed) saveIndex();
    } catch (error) {
        console.warn('[panel/offline] index check failed', error);
    }
}
