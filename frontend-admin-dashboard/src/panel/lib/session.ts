/**
 * Panel session: the same accessToken/refreshToken cookies as the admin app, and
 * sign-out that keeps the device's panel settings.
 *
 * Paired mode: the access cookie is a short JWT and the refresh cookie an opaque
 * session token, both from a QR approval or /session/login-password. The server
 * decides when a session is over. Signed in means the session token cookie exists
 * and the server has not ended it; JWT expiry is never compared with this panel's
 * clock, which can be wrong.
 *
 * Phase 0 (lab builds only, VITE_PANEL_LEGACY_LOGIN=1, unpaired): username and
 * password against login-root, with the institute choice. Flow copied from
 * hooks/login/login-button.tsx + lib/auth/loginFlowHandler.ts (first part only);
 * neither is imported (loginFlowHandler pulls 52 files).
 */
import { useSyncExternalStore } from 'react';
import { LOGIN_URL } from '@/constants/urls';
import type {
    PanelClientEndReason,
    PanelRedeemedSession,
    PanelSessionEndReason,
    SessionLoginPasswordResponse,
} from '@/classroom-shared/apiTypes';
import {
    getInstituteSelectionResult,
    getInstitutesFromToken,
    getValidInstitutes,
    setSelectedInstitute,
    shouldBlockStudentLogin,
    type Institute,
} from '@/lib/auth/instituteUtils';
import {
    PANEL_ACTIVITY_WRITE_MS,
    PANEL_IDLE_SIGNOUT_MS,
    PANEL_LEGACY_LOGIN,
    PANEL_LIVE_SESSION_EXEMPT_MS,
    PANEL_STORAGE_KEYS,
    SHARED_STORAGE_KEYS,
} from '../config';
import { hasCode, isOfflineFailure, isPublicError, postPublic } from '../device/publicApi';
import {
    clearPendingEnd,
    clearSessionMeta,
    deviceCredentials,
    readActiveDevice,
    readDevice,
    readSessionMeta,
    subscribeDevice,
    subscribeDeviceEvents,
    usesDeviceAuth,
    writePendingEnd,
    writeSessionMeta,
} from '../device/store';
import { setOpenedClassEnd } from '../device/activity';
import { resetNavBaseline } from '../seams/remoteTarget';
import { AUTH_REQUIRED_SCREENS, getCurrentRoute, navigate } from '../router';
import {
    clearPanelSession,
    decodeAccessToken,
    getAccessToken,
    getInstituteIdForRequests,
    getRefreshToken,
    noteTokenLifetimes,
    notifySessionChanged,
    refreshAccessToken,
    setSessionEndHandler,
    subscribeSession,
    writeAuthCookies,
} from './api';
import { closeMeeting } from './native';
import { readJson, readString, removeKey, writeString } from './storage';

export type PanelLoginErrorCode =
    | 'WRONG_CREDENTIALS'
    | 'STUDENT_BLOCKED'
    | 'NO_INSTITUTE'
    | 'NETWORK'
    | 'SERVER';

export class PanelLoginError extends Error {
    code: PanelLoginErrorCode;
    constructor(code: PanelLoginErrorCode, message?: string) {
        super(message || code);
        this.name = 'PanelLoginError';
        this.code = code;
    }
}

export type PanelLoginResult =
    | { status: 'ready'; instituteId: string }
    | { status: 'pick'; institutes: Institute[] };

export interface PanelUser {
    id: string;
    fullName: string;
    email: string;
    username: string;
    roles: string[];
}

async function postLogin(
    username: string,
    password: string,
    instituteId: string | undefined
): Promise<{ accessToken: string; refreshToken: string }> {
    let response: Response;
    try {
        response = await fetch(LOGIN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_name: username,
                password,
                client_name: 'ADMIN_PORTAL',
                institute_id: instituteId,
            }),
        });
    } catch {
        throw new PanelLoginError('NETWORK');
    }
    if (!response.ok) {
        throw new PanelLoginError(response.status >= 500 ? 'SERVER' : 'WRONG_CREDENTIALS');
    }
    const body = (await response.json().catch(() => null)) as {
        accessToken?: string;
        refreshToken?: string;
    } | null;
    if (!body?.accessToken || !body.refreshToken) throw new PanelLoginError('SERVER');
    return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

/**
 * Sign in. Sends the device's last institute as institute_id (as the admin app
 * does) and retries once without it, so a teacher from another institute can
 * still sign in on a shared panel. NOTE: the backend revokes the user's other
 * refresh tokens on every login (AuthManager.loginUser).
 */
export async function loginWithPassword(
    username: string,
    password: string
): Promise<PanelLoginResult> {
    if (!PANEL_LEGACY_LOGIN) throw new PanelLoginError('SERVER');
    const cached = readString(SHARED_STORAGE_KEYS.selectedInstituteId);
    const cachedId = cached && cached !== 'null' ? cached : undefined;
    let tokens: { accessToken: string; refreshToken: string };
    try {
        tokens = await postLogin(username.trim(), password, cachedId);
    } catch (error) {
        if (!cachedId || (error instanceof PanelLoginError && error.code === 'NETWORK'))
            throw error;
        tokens = await postLogin(username.trim(), password, undefined);
    }
    writeAuthCookies(tokens.accessToken, tokens.refreshToken);
    recordActivity(true);

    if (shouldBlockStudentLogin()) {
        clearPanelSession();
        throw new PanelLoginError('STUDENT_BLOCKED');
    }
    const selection = getInstituteSelectionResult();
    if (selection.selectedInstitute) {
        selectInstitute(selection.selectedInstitute.id);
        return { status: 'ready', instituteId: selection.selectedInstitute.id };
    }
    if (selection.shouldShowSelection && selection.institutes.length > 0) {
        // selectedInstituteId survives sign-out: drop the previous teacher's choice
        // when it is not one of this teacher's institutes (SEC-5).
        const stored = readString(SHARED_STORAGE_KEYS.selectedInstituteId);
        if (stored && !selection.institutes.some((institute) => institute.id === stored)) {
            removeKey(SHARED_STORAGE_KEYS.selectedInstituteId);
        }
        return { status: 'pick', institutes: selection.institutes };
    }
    clearPanelSession();
    throw new PanelLoginError('NO_INSTITUTE');
}

export function selectInstitute(instituteId: string): void {
    setSelectedInstitute(instituteId);
    notifySessionChanged();
}

/** Institutes this teacher may use on the panel (any non-STUDENT role). */
export function getPanelInstitutes(): Institute[] {
    return getValidInstitutes(getInstitutesFromToken());
}

/**
 * Institute the panel works in: the device's on a paired panel. Otherwise the
 * selected one when the signed-in user has a valid role there, else their first
 * valid institute, else null.
 */
export function getPanelInstituteId(): string | null {
    if (!isSignedIn()) return null;
    // One rule for the UI and the clientId header (api.getInstituteIdForRequests).
    return getInstituteIdForRequests();
}

/**
 * Paired: the session token cookie exists and the server has not ended it (ending a
 * session clears the cookie and the meta). Phase 0: an access token that is still
 * valid, or one we can refresh.
 */
export function isSignedIn(): boolean {
    if (usesDeviceAuth()) return !!getRefreshToken() && !!readSessionMeta() && !!readActiveDevice();
    const token = getAccessToken();
    if (!token) return false;
    const exp = decodeAccessToken(token)?.exp;
    if (typeof exp === 'number' && exp * 1000 > Date.now()) return true;
    return !!getRefreshToken();
}

export function getCurrentUser(): PanelUser | null {
    if (!isSignedIn()) return null;
    const data = decodeAccessToken();
    if (!data) {
        // Paired, with the JWT cookie gone: the session is still good until the next refresh.
        const meta = readSessionMeta();
        if (!meta || !usesDeviceAuth()) return null;
        const name = meta.user_name || '';
        return { id: meta.user_id, fullName: name, email: '', username: name, roles: [] };
    }
    const roles: string[] = [];
    Object.keys(data.authorities || {}).forEach((id) => {
        (data.authorities[id]?.roles || []).forEach((role) => {
            if (roles.indexOf(role) < 0) roles.push(role);
        });
    });
    return {
        id: data.user,
        fullName: data.fullname || data.username || '',
        email: data.email || '',
        username: data.username || '',
        roles,
    };
}

// ------------------------------------------------------------- sign-out ---

type SignOutHandler = () => void | Promise<void>;
const beforeSignOutHandlers = new Set<SignOutHandler>();
const afterSignOutHandlers = new Set<SignOutHandler>();

/**
 * Run `handler` before the cookies are cleared (e.g. Volt ends its live
 * session while the token still works). Errors are logged and ignored.
 * Returns an unregister function.
 */
export function registerBeforeSignOut(handler: SignOutHandler): () => void {
    beforeSignOutHandlers.add(handler);
    return () => {
        beforeSignOutHandlers.delete(handler);
    };
}

/** Run `handler` after sign-out (PanelApp clears the react-query cache here). */
export function registerAfterSignOut(handler: SignOutHandler): () => void {
    afterSignOutHandlers.add(handler);
    return () => {
        afterSignOutHandlers.delete(handler);
    };
}

/** True while Volt has a live session open (it writes panel.volt.activeSession). */
export function isVoltSessionActive(): boolean {
    return readString(PANEL_STORAGE_KEYS.voltActiveSession) !== null;
}

/**
 * Whether a stored live session may suspend idle sign-out: only a record younger
 * than PANEL_LIVE_SESSION_EXEMPT_MS that belongs to the signed-in teacher (records
 * without a userId predate that field and are judged by age alone). A leftover
 * record (teacher left the Volt screen, app restarted) otherwise kept the panel
 * signed in for the cookie's whole life (review finding SEC-2). Reads the raw
 * record so the shell never imports the Volt chunk.
 */
export function isVoltSessionIdleExempt(now: number = Date.now()): boolean {
    const record = readJson<{ createdAt?: unknown; userId?: unknown }>(
        PANEL_STORAGE_KEYS.voltActiveSession
    );
    if (!record || typeof record.createdAt !== 'number') return false;
    if (now - record.createdAt >= PANEL_LIVE_SESSION_EXEMPT_MS) return false;
    if (typeof record.userId === 'string' && record.userId) {
        const user = getCurrentUser();
        if (user && user.id !== record.userId) return false;
    }
    return true;
}

// ------------------------------------------------------- idle sign-out ---

let lastActivityWrite = 0;

/**
 * Persist "the teacher touched the panel now" (throttled to PANEL_ACTIVITY_WRITE_MS
 * unless `force`), so the 3 h idle clock survives reboots and app restarts
 * (review finding SEC-1).
 */
export function recordActivity(force = false, now: number = Date.now()): void {
    if (!force && now - lastActivityWrite < PANEL_ACTIVITY_WRITE_MS) return;
    lastActivityWrite = now;
    writeString(PANEL_STORAGE_KEYS.lastActivityAt, String(now));
}

/** The persisted last-activity time, or null when missing / unreadable. */
export function readLastActivity(): number | null {
    const raw = readString(PANEL_STORAGE_KEYS.lastActivityAt);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Run at boot BEFORE the first authenticated render: when the persisted idle time
 * is already over PANEL_IDLE_SIGNOUT_MS (panel left signed in, then powered off or
 * the app restarted), sign out. Resolves true when it signed out.
 *
 * - A signed-in boot with no stored time (sessions from before this field existed)
 *   starts the clock now instead of signing out.
 * - With no live-session record the cookies are cleared synchronously, so the very
 *   first render is already signed out.
 * - With a stale live-session record the full signOut() runs (ends the class on the
 *   server while the token still works), bounded by `timeoutMs`; the cookies are
 *   cleared regardless afterwards.
 */
export function enforceIdleSignOutAtBoot(timeoutMs = 5000): Promise<boolean> {
    // Paired: the server decides at the first refresh.
    if (usesDeviceAuth()) return Promise.resolve(false);
    if (!isSignedIn()) return Promise.resolve(false);
    const now = Date.now();
    if (isVoltSessionIdleExempt(now)) {
        recordActivity(true, now);
        return Promise.resolve(false);
    }
    const last = readLastActivity();
    if (last === null) {
        recordActivity(true, now);
        return Promise.resolve(false);
    }
    if (now - last < PANEL_IDLE_SIGNOUT_MS) return Promise.resolve(false);
    if (!isVoltSessionActive()) {
        clearPanelSession();
        return runHandlers(afterSignOutHandlers).then(() => true);
    }
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (getAccessToken() || getRefreshToken()) clearPanelSession();
            resolve(true);
        };
        const timer = window.setTimeout(finish, timeoutMs);
        signOut().then(
            () => {
                window.clearTimeout(timer);
                finish();
            },
            (error) => {
                console.error('[panel/session] idle sign-out at boot failed', error);
                window.clearTimeout(timer);
                finish();
            }
        );
    });
}

async function runHandlers(handlers: Set<SignOutHandler>): Promise<void> {
    for (const handler of Array.from(handlers)) {
        try {
            await handler();
        } catch (error) {
            console.error('[panel/session] sign-out handler failed', error);
        }
    }
}

/** Before-handlers, plus a live Volt session whose chunk was never loaded this boot. */
async function endLiveWork(): Promise<void> {
    await runHandlers(beforeSignOutHandlers);
    // Volt registers its handler when its chunk loads. After an app restart the
    // record can exist while that chunk was never loaded this boot: end the
    // session here (small, Excalidraw-free module) while the token still works.
    if (isVoltSessionActive()) {
        try {
            const { endActiveVoltSession } = await import('../volt/activeSession');
            await endActiveVoltSession();
        } catch (error) {
            console.error('[panel/session] could not end the live session at sign-out', error);
        }
    }
}

function withLimit(work: Promise<void>, ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = window.setTimeout(resolve, ms);
        const done = () => {
            window.clearTimeout(timer);
            resolve();
        };
        work.then(done, done);
    });
}

/**
 * Local half of ending a paired session: the cookies, the meta, the nav baseline and the
 * end time of a class opened from a card, which belongs to this teacher only.
 */
function clearDeviceSession(): void {
    clearSessionMeta();
    resetNavBaseline();
    setOpenedClassEnd(null);
    clearPanelSession();
}

const SIGN_OUT_END_TIMEOUT_MS = 3000;
const LIVE_WORK_LIMIT_MS = 5000;

/** Tells the server, with a short limit; a miss goes to panel.pendingEnd for the sync loop. */
async function endOnServer(reason: PanelClientEndReason): Promise<void> {
    const sessionToken = getRefreshToken();
    const device = readDevice();
    if (!sessionToken || !device) return;
    try {
        await postPublic(
            '/session/end',
            { ...deviceCredentials(device), session_token: sessionToken, reason },
            { timeout: SIGN_OUT_END_TIMEOUT_MS }
        );
    } catch (error) {
        if (!isPublicError(error) || error.kind === 'offline') {
            writePendingEnd({ session_token: sessionToken, reason });
        }
    }
}

let ending: Promise<void> | null = null;

function singleEnd(work: () => Promise<void>): Promise<void> {
    if (ending) return ending;
    const run: Promise<void> = work().finally(() => {
        if (ending === run) ending = null;
    });
    ending = run;
    return run;
}

/**
 * Sign out: before-handlers (Volt ends a live session), /session/end on a paired
 * panel, then clear ONLY the two auth cookies, then after-handlers (query cache).
 * UI that calls this asks for confirmation first when isVoltSessionActive() is true.
 */
export function signOut(reason: PanelClientEndReason = 'SIGN_OUT'): Promise<void> {
    return singleEnd(async () => {
        void closeMeeting();
        await withLimit(endLiveWork(), LIVE_WORK_LIMIT_MS);
        if (usesDeviceAuth()) {
            await endOnServer(reason);
            clearDeviceSession();
        } else {
            clearPanelSession();
        }
        await runHandlers(afterSignOutHandlers);
    });
}

// ------------------------------------------------- server-side session end ---

export interface PanelSessionEndNotice {
    /** Null when the panel was not told why. */
    reason: PanelSessionEndReason | null;
}

const sessionEndListeners = new Set<(notice: PanelSessionEndNotice) => void>();

/** An end nobody was subscribed for yet, such as one during the boot refresh. */
let undeliveredEnd: PanelSessionEndNotice | null = null;

/**
 * A session ended that this panel did not sign out of itself. For the toast. An end
 * that came before anyone subscribed goes to the first subscriber, once, on the next
 * task, so the toaster has mounted by then.
 */
export function subscribeSessionEnded(
    listener: (notice: PanelSessionEndNotice) => void
): () => void {
    sessionEndListeners.add(listener);
    const waiting = undeliveredEnd;
    if (waiting) {
        undeliveredEnd = null;
        window.setTimeout(() => {
            if (sessionEndListeners.has(listener)) listener(waiting);
            else undeliveredEnd = waiting;
        }, 0);
    }
    return () => {
        sessionEndListeners.delete(listener);
    };
}

/**
 * The server said the session is over (sync, refresh), or a call kept failing after
 * a refresh (`tellServer`). Volt gets a chance to end while the JWT still works, then
 * the session is cleared and any screen that needs one goes back to Home.
 */
export function endSessionLocally(
    reason: PanelSessionEndReason | null,
    options: { tellServer?: boolean } = {}
): Promise<void> {
    if (!getRefreshToken() && !getAccessToken()) return Promise.resolve();
    return singleEnd(async () => {
        void closeMeeting();
        await withLimit(endLiveWork(), LIVE_WORK_LIMIT_MS);
        if (options.tellServer) {
            const sessionToken = getRefreshToken();
            if (sessionToken) writePendingEnd({ session_token: sessionToken, reason: 'SIGN_OUT' });
        }
        clearDeviceSession();
        await runHandlers(afterSignOutHandlers);
        if (AUTH_REQUIRED_SCREENS.indexOf(getCurrentRoute().screen) >= 0) {
            navigate('home', undefined, { replace: true });
        }
        if (sessionEndListeners.size === 0) undeliveredEnd = { reason };
        sessionEndListeners.forEach((listener) => listener({ reason }));
    });
}

setSessionEndHandler((reason, options) => {
    void endSessionLocally(reason, options);
});

subscribeDeviceEvents((event) => {
    if (event.type === 'REVOKED') void endSessionLocally(null);
});

// ---------------------------------------------------------- paired sign-in ---

export interface AdoptResult {
    /** Same teacher as before: the caller keeps the current screen and its state. */
    sameUser: boolean;
}

/**
 * Tokens from a redeemed challenge or a password sign-in. A different teacher takes
 * over cleanly: the old session is already over on the server, its JWT still ends a
 * live Volt session, and the query cache goes. The same teacher just gets new tokens.
 */
export async function adoptRedeemedSession(body: PanelRedeemedSession): Promise<AdoptResult> {
    const previous = readSessionMeta();
    const hadSession = !!getRefreshToken() && !!previous;
    const sameUser = hadSession && previous?.user_id === body.user.id;
    if (hadSession && !sameUser) {
        void closeMeeting();
        await withLimit(endLiveWork(), LIVE_WORK_LIMIT_MS);
        await runHandlers(afterSignOutHandlers);
    }
    // A class opened from a card, and an end notice nobody saw, belong to whoever was here.
    if (!sameUser) setOpenedClassEnd(null);
    undeliveredEnd = null;
    // The approval already ended whatever an undelivered /session/end was for.
    clearPendingEnd();
    const now = Date.now();
    writeSessionMeta({
        session_id: body.session_id,
        user_id: body.user.id,
        user_name: body.user.name,
        started_at_ms: now,
        last_refresh_wall_ms: now,
    });
    writeAuthCookies(body.access_token, body.session_token);
    noteTokenLifetimes(body.expires_in_s, body.session_expires_in_s);
    notifySessionChanged();
    recordActivity(true);
    return { sameUser };
}

export type DevicePasswordErrorCode =
    | 'BAD_CREDENTIALS'
    | 'NOT_STAFF'
    | 'PASSWORD_DISABLED'
    | 'OFFLINE'
    | 'SERVER';

export class DevicePasswordError extends Error {
    code: DevicePasswordErrorCode;
    constructor(code: DevicePasswordErrorCode) {
        super(code);
        this.name = 'DevicePasswordError';
        this.code = code;
    }
}

/** Password sign-in on a panel an admin switched it on for. Never touches login-root. */
export async function loginWithDevicePassword(
    username: string,
    password: string
): Promise<AdoptResult> {
    const device = readActiveDevice();
    if (!device) throw new DevicePasswordError('SERVER');
    try {
        const body = await postPublic<SessionLoginPasswordResponse>('/session/login-password', {
            ...deviceCredentials(device),
            username: username.trim(),
            password,
        });
        return await adoptRedeemedSession(body);
    } catch (error) {
        if (isOfflineFailure(error)) throw new DevicePasswordError('OFFLINE');
        if (hasCode(error, 'BAD_CREDENTIALS')) throw new DevicePasswordError('BAD_CREDENTIALS');
        if (hasCode(error, 'NOT_STAFF')) throw new DevicePasswordError('NOT_STAFF');
        if (hasCode(error, 'PASSWORD_DISABLED')) throw new DevicePasswordError('PASSWORD_DISABLED');
        throw new DevicePasswordError('SERVER');
    }
}

/** ADMIN at the device's institute. The JWT's authorities carry only that institute. */
export function isDeviceInstituteAdmin(): boolean {
    const device = readActiveDevice();
    if (!device || !isSignedIn()) return false;
    const roles = decodeAccessToken()?.authorities?.[device.institute_id]?.roles ?? [];
    return roles.indexOf('ADMIN') >= 0;
}

/**
 * Android settings and Switch Home: open before pairing, since the installer needs
 * them. Once paired, only for an admin of this institute.
 */
export function canUseDeviceSettings(): boolean {
    return !readActiveDevice() || isDeviceInstituteAdmin();
}

// -------------------------------------------------------------------- boot ---

/**
 * Cookies with no paired session behind them cannot be used: a release panel holds
 * nothing but a device session. Clears tokens left by an older build or lab login.
 */
export function clearStrayCookies(): void {
    if (!usesDeviceAuth()) return;
    if (!getAccessToken() && !getRefreshToken()) return;
    if (!readActiveDevice() || !readSessionMeta() || !getRefreshToken()) clearDeviceSession();
}

/**
 * Device and session at boot: refresh once, so a session that ended while the panel
 * was off is gone before the first authenticated screen. Bounded, because the panel
 * must still start with no network, and network failure keeps the session.
 */
export function refreshSessionAtBoot(timeoutMs = 3000): Promise<void> {
    if (!usesDeviceAuth() || !isSignedIn()) return Promise.resolve();
    return withLimit(
        refreshAccessToken().then(() => undefined),
        timeoutMs
    );
}

// ---------------------------------------------------------------- hooks ---

let snapshotKey = '';
let snapshotValue: { user: PanelUser | null; instituteId: string | null } = {
    user: null,
    instituteId: null,
};

function getSnapshot() {
    const key = `${getAccessToken() ?? ''}|${getRefreshToken() ?? ''}|${readDevice()?.revoked_at ?? ''}|${readDevice()?.device_id ?? ''}|${readString(SHARED_STORAGE_KEYS.selectedInstituteId) ?? ''}`;
    if (key !== snapshotKey) {
        snapshotKey = key;
        snapshotValue = { user: getCurrentUser(), instituteId: getPanelInstituteId() };
    }
    return snapshotValue;
}

export interface PanelSession {
    user: PanelUser | null;
    instituteId: string | null;
    isSignedIn: boolean;
    signOut: () => Promise<void>;
}

/** Reactive session (re-renders on login, logout, refresh and institute change). */
function subscribeSessionOrDevice(listener: () => void): () => void {
    const offSession = subscribeSession(listener);
    const offDevice = subscribeDevice(listener);
    return () => {
        offSession();
        offDevice();
    };
}

export function usePanelSession(): PanelSession {
    const snapshot = useSyncExternalStore(subscribeSessionOrDevice, getSnapshot, getSnapshot);
    return {
        user: snapshot.user,
        instituteId: snapshot.instituteId,
        isSignedIn: snapshot.user !== null,
        signOut,
    };
}
