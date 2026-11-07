/**
 * Panel session: username/password login against the admin login-root
 * endpoint, the same accessToken/refreshToken cookies as the admin app, the
 * institute choice, and sign-out that keeps the device's panel settings.
 *
 * Flow copied from hooks/login/login-button.tsx + lib/auth/loginFlowHandler.ts
 * (first part only); neither is imported (loginFlowHandler pulls 52 files).
 */
import { useSyncExternalStore } from 'react';
import { LOGIN_URL } from '@/constants/urls';
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
    PANEL_LIVE_SESSION_EXEMPT_MS,
    PANEL_STORAGE_KEYS,
    SHARED_STORAGE_KEYS,
} from '../config';
import {
    clearPanelSession,
    decodeAccessToken,
    getAccessToken,
    getInstituteIdForRequests,
    getRefreshToken,
    notifySessionChanged,
    subscribeSession,
    writeAuthCookies,
} from './api';
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
 * Institute the panel works in: the selected one when the signed-in user has a
 * valid role there, else their first valid institute, else null.
 */
export function getPanelInstituteId(): string | null {
    if (!isSignedIn()) return null;
    // One rule for the UI and the clientId header (api.getInstituteIdForRequests).
    return getInstituteIdForRequests();
}

/** Signed in = an access token that is still valid, or one we can refresh. */
export function isSignedIn(): boolean {
    const token = getAccessToken();
    if (!token) return false;
    const exp = decodeAccessToken(token)?.exp;
    if (typeof exp === 'number' && exp * 1000 > Date.now()) return true;
    return !!getRefreshToken();
}

export function getCurrentUser(): PanelUser | null {
    if (!isSignedIn()) return null;
    const data = decodeAccessToken();
    if (!data) return null;
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

/**
 * Sign out: before-handlers (Volt ends a live session), then clear ONLY the two
 * auth cookies, then after-handlers (query cache). UI that calls this asks for
 * confirmation first when isVoltSessionActive() is true.
 */
export async function signOut(): Promise<void> {
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
    clearPanelSession();
    await runHandlers(afterSignOutHandlers);
}

// ---------------------------------------------------------------- hooks ---

let snapshotKey = '';
let snapshotValue: { user: PanelUser | null; instituteId: string | null } = {
    user: null,
    instituteId: null,
};

function getSnapshot() {
    const key = `${getAccessToken() ?? ''}|${readString(SHARED_STORAGE_KEYS.selectedInstituteId) ?? ''}`;
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
export function usePanelSession(): PanelSession {
    const snapshot = useSyncExternalStore(subscribeSession, getSnapshot, getSnapshot);
    return {
        user: snapshot.user,
        instituteId: snapshot.instituteId,
        isSignedIn: snapshot.user !== null,
        signOut,
    };
}
