/**
 * The one periodic call: POST /sync. Keeps the device record, flags and policy up to
 * date, notices a session the server ended, feeds the phone remote, refreshes the JWT
 * before it runs out (which is what keeps the 60-minute dead-man quiet), and retries
 * an undelivered /session/end.
 *
 * The server sets the rate through next_poll_ms: 5 min signed out, 60 s signed in, 5 s
 * presenting, 1 s presenting with a phone connected, 10 s with a meeting screen open. One request at a time; a response
 * about a session that is no longer the current one is ignored. Network failure, 5xx,
 * BUSY and any 429 never touch the session: they only set the offline state.
 */
import { useSyncExternalStore } from 'react';
import type {
    EndedResponse,
    PanelFlags,
    PanelPolicy,
    PanelSyncRequest,
    PanelSyncResponse,
    PanelSyncSession,
} from '@/classroom-shared/apiTypes';
import {
    DEVICE_REVOKED_KEEP_MS,
    DEVICE_REVOKED_RECHECK_MS,
    OFFLINE_RETRY_MS,
    PANEL_REFRESH_SKEW_MS,
} from '../config';
import {
    getRefreshToken,
    msSinceLastRefresh,
    msUntilAccessExpiry,
    noteSessionRemaining,
    refreshAccessToken,
    subscribeSession,
} from '../lib/api';
import { applyDeviceBranding } from '../lib/branding';
import { endSessionLocally } from '../lib/session';
import { applyNavCounter, getRemoteTargetInfo, subscribeRemoteTarget } from '../seams/remoteTarget';
import { isMeetingOpen, notePanelActivity } from './activity';
import { getAppVersionCode, getWebViewMajor } from './deviceInfo';
import { isBackendReachable, isOfflineFailure, isPublicError, postPublic } from './publicApi';
import {
    clearDeviceRevoked,
    clearPendingEnd,
    deviceCredentials,
    forgetDevice,
    mergeSyncDevice,
    readDevice,
    readPendingEnd,
    readSessionMeta,
    subscribeDevice,
} from './store';

export const DEFAULT_PANEL_FLAGS: PanelFlags = {
    volt_live_enabled: false,
    bbb_in_app_min_webview: 9999,
};
export const DEFAULT_PANEL_POLICY: PanelPolicy = { idle_minutes: 30, session_hours: 4 };

const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 1000;
/** A change of screen or slide is reported this soon, at most one request per MIN_POLL_MS. */
const EARLY_SYNC_MS = 300;
const PENDING_END_RETRY_MS = 60 * 1000;

export interface PanelSyncSnapshot {
    /** Local time of the last answer; null until the first one. */
    lastSyncAt: number | null;
    /** Server time minus local time; 0 until the first answer. */
    serverOffsetMs: number;
    /** The current session as of the last answer. */
    session: PanelSyncSession | null;
    flags: PanelFlags;
    policy: PanelPolicy;
    minAppVersionCode: number | null;
}

let snapshot: PanelSyncSnapshot = {
    lastSyncAt: null,
    serverOffsetMs: 0,
    session: null,
    flags: DEFAULT_PANEL_FLAGS,
    policy: DEFAULT_PANEL_POLICY,
    minAppVersionCode: null,
};

const listeners = new Set<() => void>();

function publish(next: Partial<PanelSyncSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
}

/** Called after every answer from /sync. Returns an unsubscribe. */
export function subscribeSync(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getSyncSnapshot(): PanelSyncSnapshot {
    return snapshot;
}

export function useSyncSnapshot(): PanelSyncSnapshot {
    return useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot);
}

export function getPanelFlags(): PanelFlags {
    return snapshot.flags;
}

export function getPanelPolicy(): PanelPolicy {
    return snapshot.policy;
}

/** Local clock corrected by the server's. Use for anything compared with a server time. */
export function getServerNow(): number {
    return Date.now() + snapshot.serverOffsetMs;
}

// ------------------------------------------------------------------- loop ---

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
/** Something changed while a request was out: go again as soon as it returns. */
let dirty = false;
let failures = 0;
let lastSendMono = -Infinity;
let lastSessionId: string | null = null;

function schedule(delayMs: number): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        void tick();
    }, delayMs);
}

function scheduleEarly(): void {
    if (inFlight) {
        dirty = true;
        return;
    }
    const sinceLast = performance.now() - lastSendMono;
    schedule(Math.max(EARLY_SYNC_MS, MIN_POLL_MS - sinceLast));
}

/** Ask for a sync now, for example right after pairing or a sign-in. */
export function syncNow(): void {
    scheduleEarly();
}

function failureDelay(error: unknown): number {
    failures += 1;
    const backoff = Math.min(OFFLINE_RETRY_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS);
    const retryAfter = isPublicError(error) ? error.retryAfterMs : 0;
    return Math.max(backoff, retryAfter) * (1 + Math.random() * 0.2);
}

/** Forgetting credentials 24 h after DEVICE_REVOKED. True when they are gone. */
function forgetIfRevokedTooLong(): boolean {
    const device = readDevice();
    if (!device?.revoked_at) return false;
    if (Date.now() - device.revoked_at < DEVICE_REVOKED_KEEP_MS) return false;
    forgetDevice();
    return true;
}

async function flushPendingEnd(): Promise<void> {
    const pending = readPendingEnd();
    const device = readDevice();
    if (!pending || !device) return;
    if (pending.session_token === getRefreshToken()) return;
    try {
        await postPublic<EndedResponse>('/session/end', {
            ...deviceCredentials(device),
            session_token: pending.session_token,
            reason: pending.reason,
        });
        clearPendingEnd();
    } catch (error) {
        // Only a network-class failure is worth another try.
        if (!isOfflineFailure(error)) clearPendingEnd();
    }
}

/**
 * The monotonic timer does not run while the device sleeps. Time the wall clock saw pass
 * since the last refresh and the timer did not is taken off what the timer says is left.
 * A clock that went backwards adds nothing.
 */
function accessMsLeft(): number | null {
    const remaining = msUntilAccessExpiry();
    const since = msSinceLastRefresh();
    const meta = readSessionMeta();
    if (remaining === null || since === null || !meta) return remaining;
    const missed = Date.now() - meta.last_refresh_wall_ms - since;
    return missed > 0 ? remaining - missed : remaining;
}

function applySession(sentSessionId: string, session: PanelSyncSession | null | undefined): void {
    if (!session) return;
    if (session.status === 'ENDED') {
        publish({ session: null });
        void endSessionLocally(session.end_reason ?? null);
        return;
    }
    noteSessionRemaining(session.expires_in_s);
    const applied = applyNavCounter({
        session_id: sentSessionId,
        nav_counter: session.nav_counter,
        nav_age_ms: session.nav_age_ms,
    });
    if (applied.outcome === 'APPLIED') notePanelActivity();
    publish({ session });
    const remaining = accessMsLeft();
    if (remaining === null || remaining < PANEL_REFRESH_SKEW_MS) {
        refreshAccessToken().catch((error: unknown) => {
            console.warn('[panel/sync] proactive refresh failed', error);
        });
    }
}

async function tick(): Promise<void> {
    if (inFlight) {
        dirty = true;
        return;
    }
    if (forgetIfRevokedTooLong()) return;
    const device = readDevice();
    if (!device) return;

    const meta = device.revoked_at ? null : readSessionMeta();
    const sessionToken = meta ? getRefreshToken() : null;
    const sentSessionId = meta && sessionToken ? meta.session_id : null;
    const target = getRemoteTargetInfo();
    const request: PanelSyncRequest = {
        ...deviceCredentials(device),
        app_version_code: getAppVersionCode(),
        webview_major: getWebViewMajor() || null,
        presenting: !!sentSessionId && target.hasTarget,
        in_meeting: !!sentSessionId && isMeetingOpen(),
        ...(sentSessionId ? { session_id: sentSessionId, session_token: sessionToken } : {}),
        ...(sentSessionId && target.state ? { state: target.state } : {}),
    };

    inFlight = true;
    lastSendMono = performance.now();
    const sentAt = Date.now();
    let delay: number;
    try {
        const response = await postPublic<PanelSyncResponse>('/sync', request);
        failures = 0;
        const stillCurrent = readDevice();
        if (!stillCurrent || stillCurrent.device_id !== device.device_id) {
            // Pairing replaced the device while this was out.
            delay = MIN_POLL_MS;
        } else if (stillCurrent.revoked_at && !device.revoked_at) {
            // Sent before another call heard DEVICE_REVOKED: it proves nothing.
            delay = DEVICE_REVOKED_RECHECK_MS;
        } else {
            if (stillCurrent.revoked_at) clearDeviceRevoked();
            mergeSyncDevice(response.device);
            // Signed in, refreshBranding has the fuller answer; this one is for the signed-out screens.
            if (!readSessionMeta()) applyDeviceBranding(response.device);
            const receivedAt = Date.now();
            publish({
                lastSyncAt: receivedAt,
                serverOffsetMs: response.server_time_ms - Math.round((sentAt + receivedAt) / 2),
                flags: response.flags,
                policy: response.policy,
                minAppVersionCode: response.min_app_version_code,
            });
            // An answer about a session that has since been replaced says nothing about this one.
            const currentId = readSessionMeta()?.session_id ?? null;
            if (sentSessionId && sentSessionId === currentId) {
                applySession(sentSessionId, response.session);
            } else if (!currentId) {
                publish({ session: null });
            }
            await flushPendingEnd();
            delay = Math.min(Math.max(response.next_poll_ms, MIN_POLL_MS), MAX_POLL_MS);
            if (readPendingEnd()) delay = Math.min(delay, PENDING_END_RETRY_MS);
        }
    } catch (error) {
        delay = readDevice()?.revoked_at ? DEVICE_REVOKED_RECHECK_MS : failureDelay(error);
    }
    inFlight = false;
    if (dirty) {
        dirty = false;
        delay = Math.min(delay, MIN_POLL_MS);
    }
    schedule(delay);
}

/** Idempotent. Runs for the life of the app, whether or not the panel is paired yet. */
export function startSyncLoop(): void {
    if (started) return;
    started = true;
    subscribeRemoteTarget(() => {
        if (readSessionMeta()) scheduleEarly();
    });
    subscribeSession(() => {
        const current = readSessionMeta()?.session_id ?? null;
        if (current !== lastSessionId) {
            lastSessionId = current;
            scheduleEarly();
        }
    });
    let lastDeviceKey: string | null = readDevice()?.device_id ?? null;
    let lastRevoked = !!readDevice()?.revoked_at;
    subscribeDevice(() => {
        const device = readDevice();
        const key = device?.device_id ?? null;
        const revoked = !!device?.revoked_at;
        if (key !== lastDeviceKey) {
            lastDeviceKey = key;
            lastRevoked = revoked;
            scheduleEarly();
        } else if (revoked && !lastRevoked) {
            lastRevoked = true;
            if (!inFlight) schedule(DEVICE_REVOKED_RECHECK_MS);
        } else if (!revoked) {
            lastRevoked = false;
        }
    });
    window.addEventListener('online', scheduleEarly);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') scheduleEarly();
    });
    lastSessionId = readSessionMeta()?.session_id ?? null;
    void tick();
}

/** True once a sync or any other panel call has failed for a network-class reason. */
export function isPanelOffline(): boolean {
    return !isBackendReachable();
}
