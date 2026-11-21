/**
 * Lists and decks: the network first, the teacher's saved copy when the network fails or
 * is too slow to wait for. A refusal from the server is an answer, never a reason to show
 * a saved copy.
 */
import axios from 'axios';
import { isBackendReachable, isOfflineFailure } from '../device/publicApi';
import { readEntry, userCacheName, writeEntry } from './cacheStore';
import { offlineUseExpired } from './lock';
import { getWipeGeneration } from './wipe';
import { isShowingSaved, noteFreshCopy, noteSavedCopy } from './savedCopy';

/** Bigger than any real list; a deck full of images can come close. */
const MAX_JSON_BYTES = 50 * 1024 * 1024;
/** Let the screen settle first: serialising a big deck takes a moment on a weak panel. */
const SAVE_DELAY_MS = 1500;
const SLOW_MS = 8000;
const SLOW_WHEN_OFFLINE_MS = 1500;
/** How often a list on a saved copy looks for the real one. */
export const SAVED_REFRESH_MS = 30 * 1000;

const NETWORK_CLASS_STATUSES = [429, 500, 502, 503, 504];

export function isNetworkClassFailure(error: unknown): boolean {
    if (isOfflineFailure(error)) return true;
    if (axios.isCancel(error)) return false;
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        return status === undefined || NETWORK_CLASS_STATUSES.indexOf(status) >= 0;
    }
    return error instanceof Error && error.message.indexOf('Offline:') === 0;
}

async function readSaved<T>(cacheName: string, key: string): Promise<T | undefined> {
    // Past the offline limit only the server can say this session is still good.
    if (offlineUseExpired()) return undefined;
    const found = await readEntry(cacheName, key);
    if (!found) return undefined;
    try {
        return (await found.json()) as T;
    } catch {
        return undefined;
    }
}

function saveLater(cacheName: string, key: string, value: unknown): void {
    // Taken now: a wipe during the delay must cancel this write.
    const generation = getWipeGeneration();
    window.setTimeout(() => {
        try {
            const body = JSON.stringify(value);
            void writeEntry(cacheName, key, {
                produce: () =>
                    Promise.resolve(
                        new Response(body, { headers: { 'Content-Type': 'application/json' } })
                    ),
                knownSize: body.length,
                maxBytes: MAX_JSON_BYTES,
                generation,
            });
        } catch (error) {
            console.warn('[panel/offline] could not save', key, error);
        }
    }, SAVE_DELAY_MS);
}

export interface NetworkFirstOptions<T> {
    /** A result with parts missing: not saved, and a whole saved copy is preferred over it. */
    isPartial?: (value: T) => boolean;
    /** How long to wait for the network before a saved copy is shown instead. */
    slowMs?: number;
}

export async function networkFirst<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: NetworkFirstOptions<T> = {}
): Promise<T> {
    const cacheName = userCacheName();
    if (!cacheName) return fetcher();

    const loadSaved = async (): Promise<T | undefined> => {
        const saved = await readSaved<T>(cacheName, key);
        if (saved !== undefined) noteSavedCopy(key);
        return saved;
    };

    let answered = false;
    const network = fetcher().then(
        async (value) => {
            answered = true;
            if (options.isPartial?.(value)) {
                const saved = await loadSaved();
                return saved === undefined ? value : saved;
            }
            noteFreshCopy(key);
            saveLater(cacheName, key, value);
            return value;
        },
        (error: unknown) => {
            answered = true;
            throw error;
        }
    );

    const wait = isBackendReachable() ? options.slowMs ?? SLOW_MS : SLOW_WHEN_OFFLINE_MS;
    const slow = new Promise<T | undefined>((resolve) => {
        window.setTimeout(() => {
            if (answered) resolve(undefined);
            else void loadSaved().then(resolve);
        }, wait);
    });

    try {
        // The first of: a network answer, or a saved copy once the network has taken too long.
        // With no saved copy to show, the network is all there is, however long it takes.
        return await new Promise<T>((resolve, reject) => {
            network.then(resolve, reject);
            void slow.then((saved) => {
                if (saved !== undefined) resolve(saved);
            });
        });
    } catch (error) {
        if (!isNetworkClassFailure(error)) throw error;
        const saved = await loadSaved();
        if (saved === undefined) throw error;
        return saved;
    }
}

/** For react-query's refetchInterval: only while this list is on a saved copy. */
export function refreshWhileSaved(key: string): () => number | false {
    return () => (isShowingSaved(key) ? SAVED_REFRESH_MS : false);
}

/** 1 s, 2 s, 4 s. */
export function backoffDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 8000);
}
