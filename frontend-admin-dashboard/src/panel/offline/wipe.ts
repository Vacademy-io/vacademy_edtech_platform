/**
 * Wiping the offline caches. Small on purpose: it lives in the initial chunk,
 * everything else in this folder loads with the Lessons and Volt screens.
 */
import { PANEL_STORAGE_KEYS } from '../config';
import { readString, removeKey, writeString } from '../lib/storage';

export const CACHE_PREFIX_FILES = 'panel-files-';
export const CACHE_PREFIX_USER = 'panel-user-';

function isOfflineCacheName(name: string): boolean {
    return name.indexOf(CACHE_PREFIX_FILES) === 0 || name.indexOf(CACHE_PREFIX_USER) === 0;
}

let wipeGeneration = 0;

/** Bumped by every wipe: a write that started before one must not leave anything behind. */
export function getWipeGeneration(): number {
    return wipeGeneration;
}

export function cacheApiAvailable(): boolean {
    return typeof window !== 'undefined' && 'caches' in window;
}

/** Everything goes: both namespaces for every institute and user, the index and the resume record. */
export async function wipeOfflineData(): Promise<void> {
    wipeGeneration += 1;
    writeString(PANEL_STORAGE_KEYS.offlineWipe, '1');
    removeKey(PANEL_STORAGE_KEYS.offlineIndex);
    removeKey(PANEL_STORAGE_KEYS.resume);
    try {
        if (cacheApiAvailable()) {
            const names = await window.caches.keys();
            await Promise.all(
                names.filter(isOfflineCacheName).map((name) => window.caches.delete(name))
            );
        }
        removeKey(PANEL_STORAGE_KEYS.offlineWipe);
    } catch (error) {
        // The flag stays, so the next boot tries again.
        console.warn('[panel/offline] wipe failed', error);
    }
}

/** A wipe that a restart interrupted. */
export function finishInterruptedWipe(): void {
    if (readString(PANEL_STORAGE_KEYS.offlineWipe)) void wipeOfflineData();
}

export function listOfflineCacheNames(): Promise<string[]> {
    if (!cacheApiAvailable()) return Promise.resolve([]);
    return window.caches.keys().then((names) => names.filter(isOfflineCacheName));
}
