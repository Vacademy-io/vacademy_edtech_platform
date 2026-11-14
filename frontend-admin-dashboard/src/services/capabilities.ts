import { useCallback } from 'react';
import { create } from 'zustand';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CAPABILITIES_ME } from '@/constants/urls';
import { getActiveRoleDisplaySettingsKey, getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    clearDisplaySettingsCache,
    getDisplaySettings,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';

/**
 * Institute capabilities — GET /admin-core-service/capabilities/v1/me
 * (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §12.2).
 *
 * Phase 1 uses it for ONE thing: the display-settings cache lives 24 h in
 * localStorage, so when the platform team edits a role's settings from the
 * super-admin portal the server's `display_settings_version` changes and the
 * cached blob is dropped and refetched. The resolved modules/features are kept
 * in a store for `useCapabilities()`, which nothing gates on yet (Phase 2).
 *
 * Everything here fails silently and OPEN: the endpoint may not exist yet (404),
 * and a failed call must never hide anything — the server enforces.
 */

export type CapabilityMode = 'LEGACY' | 'MANAGED';

export interface CapabilitiesMe {
    mode: CapabilityMode;
    catalog_version: number | null;
    modules: Record<string, boolean>;
    features: Record<string, boolean>;
    display_settings_version: string | null;
}

type CapabilitiesStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface CapabilitiesSnapshot {
    instituteId: string | null;
    status: CapabilitiesStatus;
    data: CapabilitiesMe | null;
}

export const useCapabilitiesStore = create<CapabilitiesSnapshot>(() => ({
    instituteId: null,
    status: 'idle',
    data: null,
}));

const DISPLAY_SETTINGS_VERSION_KEY_PREFIX = 'DISPLAY_SETTINGS_SERVER_VERSION';

const isBoolMap = (value: unknown): value is Record<string, boolean> =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((v) => typeof v === 'boolean');

/** Validates the wire shape; anything unexpected (e.g. an HTML fallback page) is null. */
export function normalizeCapabilitiesMe(raw: unknown): CapabilitiesMe | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.mode !== 'string') return null;
    const version = r.display_settings_version;
    return {
        // Unknown modes behave as LEGACY: only an explicit MANAGED may ever gate.
        mode: r.mode === 'MANAGED' ? 'MANAGED' : 'LEGACY',
        catalog_version: typeof r.catalog_version === 'number' ? r.catalog_version : null,
        modules: isBoolMap(r.modules) ? r.modules : {},
        features: isBoolMap(r.features) ? r.features : {},
        display_settings_version:
            typeof version === 'string' && version.length > 0 ? version : null,
    };
}

export async function fetchMyCapabilities(instituteId: string): Promise<CapabilitiesMe | null> {
    const res = await authenticatedAxiosInstance.get<unknown>(CAPABILITIES_ME, {
        params: { instituteId },
    });
    return normalizeCapabilitiesMe(res.data);
}

/**
 * Whether the cached display settings are stale. Only a known server version that
 * differs from the one recorded with the cache counts; a cache recorded before
 * versions existed (stored = null) is refreshed once. With nothing cached, the
 * next read fetches anyway.
 */
export function shouldBustDisplaySettingsCache(args: {
    serverVersion: string | null | undefined;
    storedVersion: string | null | undefined;
    hasCachedSettings: boolean;
}): boolean {
    if (!args.serverVersion) return false;
    if (!args.hasCachedSettings) return false;
    return (args.storedVersion ?? null) !== args.serverVersion;
}

/**
 * can(featureKey): true unless capabilities are loaded for the CURRENT institute,
 * the institute is MANAGED, and the server explicitly reports the feature off.
 */
export function resolveCan(
    snapshot: CapabilitiesSnapshot,
    currentInstituteId: string | null | undefined,
    featureKey: string
): boolean {
    const { status, data, instituteId } = snapshot;
    if (status !== 'loaded' || !data) return true;
    if (!currentInstituteId || instituteId !== currentInstituteId) return true;
    if (data.mode !== 'MANAGED') return true;
    return data.features[featureKey] !== false;
}

const versionKey = (instituteId: string) => `${DISPLAY_SETTINGS_VERSION_KEY_PREFIX}-${instituteId}`;

function readStoredVersion(instituteId: string): string | null {
    try {
        return localStorage.getItem(versionKey(instituteId));
    } catch {
        return null;
    }
}

function writeStoredVersion(instituteId: string, version: string): void {
    try {
        localStorage.setItem(versionKey(instituteId), version);
    } catch {
        // Storage unavailable — the next session simply checks again.
    }
}

async function bustDisplaySettingsIfStale(instituteId: string, serverVersion: string | null) {
    // The display-settings cache is keyed on the current institute; never act on
    // a response for one the user has since switched away from.
    if (!serverVersion || getCurrentInstituteId() !== instituteId) return;
    const roleKey = getActiveRoleDisplaySettingsKey();
    const bust = shouldBustDisplaySettingsCache({
        serverVersion,
        storedVersion: readStoredVersion(instituteId),
        hasCachedSettings: !!getDisplaySettingsFromCache(roleKey),
    });
    writeStoredVersion(instituteId, serverVersion);
    if (!bust) return;
    // Clear first so a failed refetch still leaves no stale blob behind. The no-arg
    // call covers admin/teacher; custom-role keys carry role ids and need the key.
    clearDisplaySettingsCache();
    clearDisplaySettingsCache(roleKey);
    // Re-caching fires DISPLAY_SETTINGS_UPDATED_EVENT for the listening consumers.
    await getDisplaySettings(roleKey, true);
}

async function syncCapabilities(instituteId: string): Promise<void> {
    useCapabilitiesStore.setState({ instituteId, status: 'loading', data: null });
    let me: CapabilitiesMe | null = null;
    try {
        me = await fetchMyCapabilities(instituteId);
    } catch {
        me = null;
    }
    if (!me) {
        useCapabilitiesStore.setState({ instituteId, status: 'error', data: null });
        return;
    }
    useCapabilitiesStore.setState({ instituteId, status: 'loaded', data: me });
    try {
        await bustDisplaySettingsIfStale(instituteId, me.display_settings_version);
    } catch {
        // Refetch failed: the cache is already cleared, so the next read retries.
    }
}

const syncedInstitutes = new Map<string, Promise<void>>();

/**
 * getCurrentInstituteId() reads storage, which can throw (blocked storage,
 * some test environments). Gating must never take a page down with it: a
 * failed read means "unknown institute" = nothing gated.
 */
export function readCurrentInstituteIdSafely(): string | null {
    try {
        return getCurrentInstituteId() ?? null;
    } catch {
        return null;
    }
}

/**
 * Fetch /capabilities/me once per page session per institute and bust the
 * display-settings cache when the server's version moved. Never rejects.
 */
export function syncCapabilitiesOnce(
    instituteId: string | null | undefined = getCurrentInstituteId()
): Promise<void> {
    if (!instituteId) return Promise.resolve();
    const existing = syncedInstitutes.get(instituteId);
    if (existing) return existing;
    const run = syncCapabilities(instituteId).catch(() => undefined);
    syncedInstitutes.set(instituteId, run);
    return run;
}

/**
 * Capability resolver for the current institute. Fails OPEN: `can()` is true in
 * LEGACY mode, before the call resolves and when it failed. Not wired into any
 * gating yet (Phase 2).
 */
export function useCapabilities(): {
    mode: CapabilityMode;
    can: (featureKey: string) => boolean;
    isLoaded: boolean;
} {
    const snapshot = useCapabilitiesStore();
    const currentInstituteId = readCurrentInstituteIdSafely();
    const isLoaded =
        snapshot.status === 'loaded' &&
        !!snapshot.data &&
        !!currentInstituteId &&
        snapshot.instituteId === currentInstituteId;
    const can = useCallback(
        (featureKey: string) => resolveCan(snapshot, currentInstituteId, featureKey),
        [snapshot, currentInstituteId]
    );
    return {
        mode: isLoaded && snapshot.data ? snapshot.data.mode : 'LEGACY',
        can,
        isLoaded,
    };
}
