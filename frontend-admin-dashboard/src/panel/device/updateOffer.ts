/**
 * Phase 2: the app update offered on a signed-out /sync (direct channel only).
 *
 * - The native `PanelUpdater` plugin exists only in the direct build. Without it (store
 *   build, older APK, browser) nothing here does anything, the bar never shows, and the
 *   download code (updateNative.ts, a lazy chunk) is never loaded.
 * - Downloads in the background while signed out and not in a meeting. A download that
 *   finishes during a session waits; nothing is shown while a session exists.
 * - An offer needs apk_url, sha256 and size_bytes; the native side refuses anything less.
 * - The last result (ours, or the system installer's) is kept under
 *   PANEL_STORAGE_KEYS.update for Diagnostics.
 */
import { useSyncExternalStore } from 'react';
import type { PanelAppChannel, PanelSyncUpdate } from '@/classroom-shared/apiTypes';
import { PANEL_STORAGE_KEYS } from '../config';
import { readJson, writeJson } from '../lib/storage';
import { getCachedDeviceInfo } from './deviceInfo';
import { readSessionMeta } from './store';

export type UpdatePhase = 'none' | 'downloading' | 'ready' | 'installing' | 'needsPermission';

export interface UpdateResult {
    at_ms: number;
    version_code: number;
    outcome:
        | 'DOWNLOADED'
        | 'DOWNLOAD_FAILED'
        | 'INSTALL_STARTED'
        | 'INSTALL_FAILED'
        /** What the system installer answered; `code` holds its status. */
        | 'INSTALL_RESULT';
    code?: string | null;
}

export interface UpdateState {
    /** The last offer heard on a signed-out sync; null when none. */
    offer: PanelSyncUpdate | null;
    phase: UpdatePhase;
    /** 0..100 while downloading, null when the size is unknown. */
    progress: number | null;
    /** The updater plugin is in this build. */
    available: boolean;
    last: UpdateResult | null;
}

const listeners = new Set<() => void>();
let state: UpdateState = {
    offer: null,
    phase: 'none',
    progress: null,
    available: false,
    last: readJson<UpdateResult>(PANEL_STORAGE_KEYS.update),
};

/** For updateNative.ts only. */
export function setUpdateState(next: Partial<UpdateState>): void {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
}

/** For updateNative.ts only: keeps the result for Diagnostics. */
export function rememberUpdate(result: Omit<UpdateResult, 'at_ms'>, atMs = Date.now()): void {
    const last = { ...result, at_ms: atMs };
    writeJson(PANEL_STORAGE_KEYS.update, last);
    setUpdateState({ last });
}

interface CapacitorGlobal {
    isNativePlatform?: () => boolean;
    isPluginAvailable?: (name: string) => boolean;
}

/**
 * The native updater is in this build. Read from the Capacitor global the native bridge
 * installs, so this file (part of the first load) needs no Capacitor import of its own.
 */
export function hasUpdater(): boolean {
    try {
        const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
        return (
            !!cap &&
            !!cap.isNativePlatform &&
            cap.isNativePlatform() &&
            !!cap.isPluginAvailable &&
            cap.isPluginAvailable('PanelUpdater')
        );
    } catch {
        return false;
    }
}

let native: Promise<typeof import('./updateNative')> | null = null;

function loadNative(): Promise<typeof import('./updateNative')> {
    if (!native) native = import('./updateNative');
    return native;
}

/** Called by the sync loop after every answer, with the update block or null. */
export function noteUpdateOffer(update: PanelSyncUpdate | null): void {
    // Runs inside the sync loop's answer handling: it must never throw there.
    try {
        // Signed-in answers never carry an offer: keep what a signed-out one said.
        if (readSessionMeta() || !hasUpdater()) return;
        loadNative()
            .then((module) => module.considerOffer(update))
            .catch((error: unknown) => console.warn('[panel/update] offer not handled', error));
    } catch (error) {
        console.warn('[panel/update] offer not handled', error);
    }
}

/** "Install": signed out and not in a meeting only. */
export async function installUpdate(): Promise<void> {
    if (!hasUpdater()) return;
    try {
        await (await loadNative()).installUpdate();
    } catch (error) {
        console.warn('[panel/update] install not started', error);
    }
}

export function subscribeUpdate(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getUpdateState(): UpdateState {
    return state;
}

export function useUpdateState(): UpdateState {
    return useSyncExternalStore(subscribeUpdate, getUpdateState, getUpdateState);
}

const CHANNELS: PanelAppChannel[] = ['PLAY', 'DIRECT', 'DEV'];

/**
 * The channel to report as app_channel on /sync, or null to leave it out (what phase 1
 * builds do). Read from the native device info once that reports it.
 */
export function getAppChannelForSync(): PanelAppChannel | null {
    try {
        const channel = getCachedDeviceInfo()?.channel;
        return channel && CHANNELS.indexOf(channel as PanelAppChannel) >= 0
            ? (channel as PanelAppChannel)
            : null;
    } catch {
        return null;
    }
}
