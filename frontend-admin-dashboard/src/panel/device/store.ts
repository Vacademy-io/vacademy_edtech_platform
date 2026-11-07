/**
 * What the panel remembers about being paired: panel.device, panel.pairing,
 * panel.sessionMeta and panel.pendingEnd, all in localStorage. Everything here
 * survives sign-out. No React beyond the one store hook, and no network.
 *
 * Paired mode means panel.device exists. A device with `revoked_at` is kept for
 * 24 h and rechecked, so one bad server response cannot unpair a school's panels
 * for good (see syncLoop.ts).
 */
import { useSyncExternalStore } from 'react';
import type {
    PairPollResponse,
    PanelClientEndReason,
    PanelDeviceCredentials,
    PanelSyncDevice,
} from '@/classroom-shared/apiTypes';
import { PANEL_LEGACY_LOGIN, PANEL_STORAGE_KEYS } from '../config';
import { readJson, readString, removeKey, writeJson } from '../lib/storage';

export interface PanelDeviceRecord extends PanelDeviceCredentials {
    institute_id: string;
    institute_name: string | null;
    room_name: string | null;
    /** Scheme and host. Null until the first sync after pairing. */
    approve_base_url: string | null;
    theme_code: string | null;
    password_login_allowed?: boolean;
    /** Wall clock of the last DEVICE_REVOKED answer; absent while paired normally. */
    revoked_at?: number | null;
}

export type PanelClaim = Omit<Extract<PairPollResponse, { state: 'CLAIMED' }>, 'poll_after_ms'>;

export interface PanelPairingRecord {
    pair_secret: string;
    /** Set once an admin has claimed the panel, until the Confirm tap. */
    claim?: PanelClaim | null;
}

export interface PanelSessionMeta {
    session_id: string;
    user_id: string;
    user_name?: string | null;
    started_at_ms: number;
    last_refresh_wall_ms: number;
}

export interface PanelPendingEnd {
    session_token: string;
    reason: PanelClientEndReason;
}

export type PanelDeviceEvent =
    | { type: 'REVOKED'; institute_id: string }
    | { type: 'RESTORED'; institute_id: string }
    | { type: 'INSTITUTE_CHANGED'; institute_id: string; previous_institute_id: string }
    | { type: 'PAIRING_CANCELLED' };

const listeners = new Set<() => void>();
const eventListeners = new Set<(event: PanelDeviceEvent) => void>();

function notify(): void {
    listeners.forEach((listener) => listener());
}

function emit(event: PanelDeviceEvent): void {
    eventListeners.forEach((listener) => {
        try {
            listener(event);
        } catch (error) {
            console.error('[panel/device] event listener failed', error);
        }
    });
}

/** Re-renders on pairing, revoke, restore and any change to the stored record. */
export function subscribeDevice(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Revoke, restore, institute change and cancelled pairing. Used for what has to go
 * with them, such as the offline caches. Returns an unsubscribe.
 */
export function subscribeDeviceEvents(listener: (event: PanelDeviceEvent) => void): () => void {
    eventListeners.add(listener);
    return () => {
        eventListeners.delete(listener);
    };
}

let cachedRaw: string | null = null;
let cachedDevice: PanelDeviceRecord | null = null;

export function readDevice(): PanelDeviceRecord | null {
    const raw = readString(PANEL_STORAGE_KEYS.device);
    if (raw !== cachedRaw) {
        cachedRaw = raw;
        const parsed = readJson<PanelDeviceRecord>(PANEL_STORAGE_KEYS.device);
        cachedDevice =
            parsed &&
            typeof parsed.device_id === 'string' &&
            typeof parsed.device_secret === 'string'
                ? parsed
                : null;
    }
    return cachedDevice;
}

function writeDevice(record: PanelDeviceRecord): void {
    writeJson(PANEL_STORAGE_KEYS.device, record);
    notify();
}

/** Paired and not currently refused by the server. */
export function readActiveDevice(): PanelDeviceRecord | null {
    const device = readDevice();
    return device && !device.revoked_at ? device : null;
}

/**
 * True when auth runs through the device: always in a release build, and in a lab
 * build as soon as the panel has been paired.
 */
export function usesDeviceAuth(): boolean {
    return !PANEL_LEGACY_LOGIN || readDevice() !== null;
}

export function useDeviceRecord(): PanelDeviceRecord | null {
    return useSyncExternalStore(subscribeDevice, readDevice, readDevice);
}

export function deviceCredentials(device: PanelDeviceCredentials): PanelDeviceCredentials {
    return { device_id: device.device_id, device_secret: device.device_secret };
}

/** Confirm tapped: this overwrites any earlier (including revoked) credentials. */
export function savePairedDevice(claim: PanelClaim): void {
    const previous = readDevice();
    removeKey(PANEL_STORAGE_KEYS.pairing);
    writeDevice({
        device_id: claim.device_id,
        device_secret: claim.device_secret,
        institute_id: claim.institute_id,
        institute_name: claim.institute_name,
        room_name: claim.room?.name ?? null,
        approve_base_url: null,
        theme_code: claim.theme_code,
    });
    if (previous && previous.institute_id !== claim.institute_id) {
        emit({
            type: 'INSTITUTE_CHANGED',
            institute_id: claim.institute_id,
            previous_institute_id: previous.institute_id,
        });
    }
}

/** Fresh values from /sync. Writes only when something changed. */
export function mergeSyncDevice(fresh: PanelSyncDevice): void {
    const device = readDevice();
    if (!device) return;
    const next: PanelDeviceRecord = {
        ...device,
        institute_id: fresh.institute_id,
        institute_name: fresh.institute_name,
        room_name: fresh.room_name,
        approve_base_url: fresh.approve_base_url,
        theme_code: fresh.theme_code,
        password_login_allowed: fresh.password_login_allowed,
    };
    if (JSON.stringify(next) !== JSON.stringify(device)) writeDevice(next);
}

/**
 * Only the exact DEVICE_REVOKED answer gets here, and only for the credentials that
 * are stored now: a late answer about credentials already replaced by a new pairing
 * must not touch them.
 */
export function markDeviceRevoked(deviceId: unknown, secret: unknown, now = Date.now()): void {
    const device = readDevice();
    if (!device || device.device_id !== deviceId || device.device_secret !== secret) return;
    if (device.revoked_at) return;
    writeDevice({ ...device, revoked_at: now });
    emit({ type: 'REVOKED', institute_id: device.institute_id });
}

export function clearDeviceRevoked(): void {
    const device = readDevice();
    if (!device || !device.revoked_at) return;
    removeKey(PANEL_STORAGE_KEYS.pairing);
    writeDevice({ ...device, revoked_at: null });
    emit({ type: 'RESTORED', institute_id: device.institute_id });
}

export function forgetDevice(): void {
    if (!readDevice()) return;
    removeKey(PANEL_STORAGE_KEYS.device);
    notify();
}

export function notifyPairingCancelled(): void {
    emit({ type: 'PAIRING_CANCELLED' });
}

// ---------------------------------------------------------------- pairing ---

export function readPairing(): PanelPairingRecord | null {
    const record = readJson<PanelPairingRecord>(PANEL_STORAGE_KEYS.pairing);
    return record && typeof record.pair_secret === 'string' ? record : null;
}

export function writePairing(record: PanelPairingRecord): void {
    writeJson(PANEL_STORAGE_KEYS.pairing, record);
}

export function clearPairing(): void {
    removeKey(PANEL_STORAGE_KEYS.pairing);
}

// ----------------------------------------------------------- session meta ---

export function readSessionMeta(): PanelSessionMeta | null {
    const meta = readJson<PanelSessionMeta>(PANEL_STORAGE_KEYS.sessionMeta);
    return meta && typeof meta.session_id === 'string' ? meta : null;
}

export function writeSessionMeta(meta: PanelSessionMeta): void {
    writeJson(PANEL_STORAGE_KEYS.sessionMeta, meta);
}

export function clearSessionMeta(): void {
    removeKey(PANEL_STORAGE_KEYS.sessionMeta);
}

// ------------------------------------------------------------ pending end ---

export function readPendingEnd(): PanelPendingEnd | null {
    const pending = readJson<PanelPendingEnd>(PANEL_STORAGE_KEYS.pendingEnd);
    return pending && typeof pending.session_token === 'string' ? pending : null;
}

export function writePendingEnd(pending: PanelPendingEnd): void {
    writeJson(PANEL_STORAGE_KEYS.pendingEnd, pending);
}

export function clearPendingEnd(): void {
    removeKey(PANEL_STORAGE_KEYS.pendingEnd);
}
