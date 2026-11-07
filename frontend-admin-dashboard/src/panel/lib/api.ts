/**
 * panelApi — the panel's authenticated axios instance.
 *
 * vite.panel.config.ts redirects every import of src/lib/auth/axiosInstance.ts
 * to this file, so reused admin services get it too (default export, same as
 * the admin instance).
 *
 * Two modes:
 *
 * Paired (panel.device exists, and always in a release build). The access cookie
 * holds a 15-minute JWT and the refresh cookie an opaque session token.
 * - Refresh is POST /session/refresh with the device credentials, single-flight,
 *   when under PANEL_REFRESH_SKEW_MS is left. Expiry comes from `expires_in_s` and
 *   a performance.now() timer, never from JWT exp against Date.now(): a panel with
 *   no RTC battery can have any date. After a cold boot the timer is unknown, so
 *   the first request refreshes once.
 * - Network failure, 5xx and BUSY never end a session. Only 401 SESSION_ENDED from
 *   refresh does (DEVICE_REVOKED has its own path in device/store.ts).
 * - A 401 on a normal call refreshes once and retries once, then ends the session.
 *   The filter's other expiry answers (403 from the error dispatch, 510, 511) also
 *   refresh and retry once, but a repeat after the retry fails only that request.
 *   460 ends it too, as a backstop.
 * - clientId is always the device's institute.
 *
 * Phase 0 (lab builds with VITE_PANEL_LEGACY_LOGIN=1, panel not paired). Dropped
 * from a release bundle.
 * - Refresh uses POST REFRESH_TOKEN_URL {token} → {accessToken} only
 *   (AuthManager.refreshToken). The refresh token is kept and both cookies are
 *   re-written to extend their 7-day life. Single-flight. It runs when the access
 *   JWT is within REFRESH_SKEW_MS (24 h) of expiry.
 * - On 401 / 511 / 403 ACCESS_REVOKED it clears ONLY the two auth cookies
 *   (never removeCookiesAndLogout, which wipes all localStorage) and sends the
 *   user to #/login when the current screen needs a session.
 *
 * Both:
 * - No Sentry, no AI-usage dialog, no perf/formatter imports.
 * - Session generation: every sign-in / sign-out bumps `sessionGen`, and a
 *   refresh that started in an older generation discards its result, so a slow
 *   refresh can never re-sign-in a teacher who signed out or overwrite the next
 *   teacher's cookies (review finding SEC-3).
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import { jwtDecode } from 'jwt-decode';
import i18next from 'i18next';
import { REFRESH_TOKEN_URL } from '@/constants/urls';
import { TokenKey, type IAccessToken } from '@/constants/auth/tokens';
import type { PanelSessionEndReason, SessionRefreshResponse } from '@/classroom-shared/apiTypes';
import {
    PANEL_BLOCKED_ROLE,
    PANEL_LEGACY_LOGIN,
    PANEL_REFRESH_BACKOFF_MS,
    PANEL_REFRESH_SKEW_MS,
    REFRESH_SKEW_MS,
    SHARED_STORAGE_KEYS,
} from '../config';
import { hasCode, isOfflineFailure, isPublicError, postPublic } from '../device/publicApi';
import {
    deviceCredentials,
    readActiveDevice,
    readDevice,
    readSessionMeta,
    usesDeviceAuth,
    writeSessionMeta,
} from '../device/store';
import { AUTH_REQUIRED_SCREENS, getCurrentRoute, redirectToLogin } from '../router';
import { readString } from './storage';

// ---------------------------------------------------------------- cookies ---

/** Same options as sessionUtility.setAuthorizationCookie (host-scoped, 7 days, lax). */
function cookieOptions(): Cookies.CookieAttributes {
    const sharedDomain =
        (import.meta.env.VITE_SHARED_DOMAIN as string | undefined)?.replace('.', '') ||
        'vacademy.io';
    return {
        secure: window.location.hostname.includes(sharedDomain),
        sameSite: 'lax',
        expires: 7,
    };
}

export function getAccessToken(): string | null {
    return Cookies.get(TokenKey.accessToken) ?? null;
}

export function getRefreshToken(): string | null {
    return Cookies.get(TokenKey.refreshToken) ?? null;
}

export function decodeAccessToken(token: string | null = getAccessToken()): IAccessToken | null {
    if (!token) return null;
    try {
        return jwtDecode<IAccessToken>(token);
    } catch {
        return null;
    }
}

const sessionListeners = new Set<() => void>();

/** Subscribe to sign-in / sign-out / refresh (returns unsubscribe). */
export function subscribeSession(listener: () => void): () => void {
    sessionListeners.add(listener);
    return () => {
        sessionListeners.delete(listener);
    };
}

export function notifySessionChanged(): void {
    sessionListeners.forEach((listener) => {
        try {
            listener();
        } catch (error) {
            console.error('[panel/api] session listener failed', error);
        }
    });
}

/** Bumped by every sign-in and sign-out; see refreshAccessToken. */
let sessionGen = 0;
let refreshInFlight: Promise<string> | null = null;

function setAuthCookies(accessToken: string, refreshToken: string): void {
    const options = cookieOptions();
    Cookies.set(TokenKey.accessToken, accessToken, options);
    Cookies.set(TokenKey.refreshToken, refreshToken, options);
}

/** Sign-in: write both auth cookies directly (no amplitude side effect). New session generation. */
export function writeAuthCookies(accessToken: string, refreshToken: string): void {
    sessionGen++;
    refreshInFlight = null;
    resetSessionTimers();
    setAuthCookies(accessToken, refreshToken);
    notifySessionChanged();
}

// -------------------------------------------------- paired session timers ---

/** performance.now(): unaffected by the panel's wall clock being wrong or corrected. */
function monoNow(): number {
    return performance.now();
}

let accessExpiryMono: number | null = null;
let sessionExpiryMono: number | null = null;
let lastRefreshMono: number | null = null;
let refreshBlockedUntilMono = 0;

function resetSessionTimers(): void {
    accessExpiryMono = null;
    sessionExpiryMono = null;
    lastRefreshMono = null;
    refreshBlockedUntilMono = 0;
}

/** Tokens were just issued or refreshed. */
export function noteTokenLifetimes(expiresInS: number, sessionExpiresInS?: number): void {
    const now = monoNow();
    accessExpiryMono = now + expiresInS * 1000;
    lastRefreshMono = now;
    if (typeof sessionExpiresInS === 'number') noteSessionRemaining(sessionExpiresInS);
}

/** The server's latest word on how long the session has left. */
export function noteSessionRemaining(expiresInS: number): void {
    sessionExpiryMono = monoNow() + expiresInS * 1000;
}

/** Time left on the access JWT by the monotonic timer; null until the first refresh. */
export function msUntilAccessExpiry(): number | null {
    return accessExpiryMono === null ? null : accessExpiryMono - monoNow();
}

/** Time left on the session cap; null until the server has been heard from. */
export function msUntilSessionCap(): number | null {
    return sessionExpiryMono === null ? null : sessionExpiryMono - monoNow();
}

/** Time since the last refresh by the monotonic timer; null until the first one. */
export function msSinceLastRefresh(): number | null {
    return lastRefreshMono === null ? null : monoNow() - lastRefreshMono;
}

export type SessionEndHandler = (
    reason: PanelSessionEndReason | null,
    options: { tellServer: boolean }
) => void;

let sessionEndHandler: SessionEndHandler | null = null;

/** session.ts owns ending a session; this keeps api.ts from importing it. */
export function setSessionEndHandler(handler: SessionEndHandler): void {
    sessionEndHandler = handler;
}

/**
 * Sign-out storage effect: removes ONLY the two auth cookies. Keeps every
 * panel.* key, selectedInstituteId and the theme keys. New session generation,
 * so an in-flight refresh cannot write the cookies back.
 */
export function clearPanelSession(): void {
    sessionGen++;
    refreshInFlight = null;
    resetSessionTimers();
    Cookies.remove(TokenKey.accessToken);
    Cookies.remove(TokenKey.refreshToken);
    notifySessionChanged();
}

/**
 * Institutes the signed-in user may use on the panel: any authority with a role
 * other than STUDENT (same rule as instituteUtils.getValidInstitutes; inlined here
 * to avoid the session.ts / instituteUtils import cycle).
 */
export function getPanelValidInstituteIds(token: string | null = getAccessToken()): string[] {
    const authorities = decodeAccessToken(token)?.authorities;
    if (!authorities) return [];
    return Object.keys(authorities).filter((id) =>
        (authorities[id]?.roles || []).some((role) => role !== PANEL_BLOCKED_ROLE)
    );
}

/**
 * Institute for the `clientId` header AND the UI (session.getPanelInstituteId):
 * the stored selectedInstituteId only when the current token has a non-STUDENT
 * role there (it survives sign-out, so it may belong to the previous teacher),
 * else the first valid institute, else null (review finding SEC-5).
 */
export function getInstituteIdForRequests(): string | null {
    if (usesDeviceAuth()) return readDevice()?.institute_id ?? null;
    const valid = getPanelValidInstituteIds();
    const selected = readString(SHARED_STORAGE_KEYS.selectedInstituteId);
    if (selected && valid.indexOf(selected) >= 0) return selected;
    return valid[0] ?? null;
}

// ---------------------------------------------------------------- refresh ---

/** Thrown when the session changed (sign-out / another sign-in) while a refresh was in flight. */
const SESSION_CHANGED = 'SESSION_CHANGED';

/**
 * Paired mode: /session/refresh. Concurrent callers share one request. Rejects with
 * the PanelPublicError on failure, after ending the session for SESSION_ENDED; the
 * caller decides what a network failure means for its own request.
 */
function refreshDeviceSession(): Promise<string> {
    if (refreshInFlight) return refreshInFlight;
    const sessionToken = getRefreshToken();
    const device = readActiveDevice();
    if (!sessionToken || !device) return Promise.reject(new Error('NO_REFRESH_TOKEN'));
    const gen = sessionGen;
    const stale = () => gen !== sessionGen || getRefreshToken() !== sessionToken;
    const request: Promise<string> = postPublic<SessionRefreshResponse>('/session/refresh', {
        ...deviceCredentials(device),
        session_token: sessionToken,
    })
        .then((response) => {
            // Signed out, or another teacher signed in, while this was in flight: drop it.
            if (stale()) throw new Error(SESSION_CHANGED);
            setAuthCookies(response.access_token, sessionToken);
            noteTokenLifetimes(response.expires_in_s, response.session_expires_in_s);
            refreshBlockedUntilMono = 0;
            const meta = readSessionMeta();
            if (meta) writeSessionMeta({ ...meta, last_refresh_wall_ms: Date.now() });
            notifySessionChanged();
            return response.access_token;
        })
        .catch((error: unknown) => {
            if (stale()) throw new Error(SESSION_CHANGED);
            if (hasCode(error, 'SESSION_ENDED')) {
                const reason = isPublicError(error) ? error.body?.reason ?? null : null;
                sessionEndHandler?.(reason, { tellServer: false });
            } else {
                refreshBlockedUntilMono = monoNow() + PANEL_REFRESH_BACKOFF_MS;
            }
            throw error;
        })
        .finally(() => {
            if (refreshInFlight === request) refreshInFlight = null;
        });
    refreshInFlight = request;
    return request;
}

/** New access token, by whichever route this panel signs in. */
export function refreshAccessToken(): Promise<string> {
    if (!PANEL_LEGACY_LOGIN || usesDeviceAuth()) return refreshDeviceSession();
    return refreshLegacySession();
}

/**
 * POST REFRESH_TOKEN_URL {token: refreshToken} → new access token. Concurrent
 * callers share one request. Rejects when there is no refresh token or the
 * backend refuses (403 = token unknown / access revoked).
 */
function refreshLegacySession(): Promise<string> {
    if (refreshInFlight) return refreshInFlight;
    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.reject(new Error('NO_REFRESH_TOKEN'));
    const gen = sessionGen;
    const request: Promise<string> = axios
        .post<{ accessToken?: string }>(
            REFRESH_TOKEN_URL,
            { token: refreshToken },
            { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
        )
        .then((response) => {
            // Signed out, or another teacher signed in, while this was in flight: drop it.
            if (gen !== sessionGen || getRefreshToken() !== refreshToken) {
                throw new Error(SESSION_CHANGED);
            }
            const accessToken = response.data?.accessToken;
            if (!accessToken) throw new Error('Refresh response had no accessToken');
            // The backend returns accessToken ONLY: keep (and re-extend) the refresh token.
            // Same session generation: set the cookies without bumping it.
            setAuthCookies(accessToken, refreshToken);
            notifySessionChanged();
            return accessToken;
        })
        .finally(() => {
            if (refreshInFlight === request) refreshInFlight = null;
        });
    refreshInFlight = request;
    return request;
}

function msUntilExpiry(token: string): number | null {
    const exp = decodeAccessToken(token)?.exp;
    return typeof exp === 'number' ? exp * 1000 - Date.now() : null;
}

/** The session is gone: drop cookies and, if this screen needs one, go to login. */
export function handleSessionEnded(reason: string): void {
    console.warn(`[panel/api] session ended: ${reason}`);
    if (!PANEL_LEGACY_LOGIN || usesDeviceAuth()) {
        sessionEndHandler?.(null, { tellServer: true });
        return;
    }
    const hadSession = !!getAccessToken() || !!getRefreshToken();
    clearPanelSession();
    const route = getCurrentRoute();
    if (hadSession && AUTH_REQUIRED_SCREENS.indexOf(route.screen) >= 0) {
        redirectToLogin(route);
    }
}

// --------------------------------------------------------------- instance ---

export interface PanelRequestConfig extends InternalAxiosRequestConfig {
    /** A 401 from this request must not end the session (separately authenticated services). */
    skipAuthLogout?: boolean;
    /** Paired mode: this is the one retry after a refresh. */
    panelAuthRetried?: boolean;
    /** Paired mode: the sign-in generation this request was sent in. */
    panelSessionGen?: number;
}

const panelApi = axios.create();

function setCommonHeaders(config: InternalAxiosRequestConfig, accessToken: string | null): void {
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
    if (!config.headers.clientId) {
        const instituteId = getInstituteIdForRequests();
        if (instituteId) config.headers.clientId = instituteId;
    }
    if (!config.headers['Accept-Language']) {
        config.headers['Accept-Language'] =
            i18next.language || readString(SHARED_STORAGE_KEYS.locale) || 'en';
    }
}

/** Paired mode. Being offline never ends the session; the request just goes with what it has. */
async function prepareDeviceRequest(
    config: InternalAxiosRequestConfig
): Promise<InternalAxiosRequestConfig> {
    if (!getRefreshToken()) {
        handleSessionEnded('no session token');
        throw new Error('Not signed in');
    }
    (config as PanelRequestConfig).panelSessionGen = sessionGen;
    let accessToken = getAccessToken();
    const remaining = msUntilAccessExpiry();
    if (
        (remaining === null || remaining < PANEL_REFRESH_SKEW_MS) &&
        monoNow() >= refreshBlockedUntilMono
    ) {
        try {
            accessToken = await refreshDeviceSession();
        } catch (error) {
            if (error instanceof Error && error.message === SESSION_CHANGED) {
                throw new Error('The session changed. Please try again.');
            }
            if (!isOfflineFailure(error)) {
                throw new Error('Session expired. Please sign in again.');
            }
            console.warn('[panel/api] refresh failed, continuing with current token', error);
        }
    }
    if (!accessToken) throw new Error('Offline: no access token yet');
    setCommonHeaders(config, accessToken);
    return config;
}

async function prepareLegacyRequest(
    config: InternalAxiosRequestConfig
): Promise<InternalAxiosRequestConfig> {
    let accessToken = getAccessToken();
    if (!accessToken) {
        handleSessionEnded('no access token');
        throw new Error('Not signed in');
    }

    const remaining = msUntilExpiry(accessToken);
    if (remaining === null || remaining < REFRESH_SKEW_MS) {
        try {
            accessToken = await refreshLegacySession();
        } catch (error) {
            // The session this request started in is gone: never send its old token.
            if (error instanceof Error && error.message === SESSION_CHANGED) {
                throw new Error('The session changed. Please try again.');
            }
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            const expired = remaining === null || remaining <= 0;
            // A refused refresh (4xx) or an expired access token ends the session; a
            // transient failure with a still-valid token just carries on.
            if (expired || (status !== undefined && status >= 400 && status < 500)) {
                handleSessionEnded(`refresh failed (${status ?? 'network'})`);
                throw new Error('Session expired. Please sign in again.');
            }
            console.warn('[panel/api] refresh failed, continuing with current token', error);
        }
    }

    setCommonHeaders(config, accessToken);
    return config;
}

panelApi.interceptors.request.use((config) => {
    if (!PANEL_LEGACY_LOGIN || usesDeviceAuth()) return prepareDeviceRequest(config);
    return prepareLegacyRequest(config);
});

function skipsLogout(config?: PanelRequestConfig): boolean {
    if (!config) return false;
    if (config.skipAuthLogout) return true;
    return (config.url ?? '').indexOf('/ai-service') >= 0;
}

/**
 * The JWT filter reports an expired Bearer as a 510 or 403 with this text rather
 * than a 401, and a monotonic timer that stopped during device sleep can get here.
 * The same expiry through the JSON security chain is a 403 ACCESS_DENIED naming /error,
 * because it comes from the error dispatch; a plain refusal names the path asked for.
 */
function bodySaysExpired(data: unknown): boolean {
    if (!data) return false;
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return text.indexOf('Expired Token') >= 0;
}

function isRevoked(status: number | undefined, data: unknown): boolean {
    const body = data as { error?: unknown } | null;
    return status === 403 && body?.error === 'ACCESS_REVOKED';
}

function isDeviceAuthFailure(status: number | undefined, data: unknown): boolean {
    if (status === 401 || status === 511) return true;
    const body = data as { error?: unknown; path?: unknown } | null;
    if (isRevoked(status, data)) return true;
    if (status === 403 && body?.error === 'ACCESS_DENIED' && body?.path === '/error') return true;
    return (status === 403 || status === 510) && bodySaysExpired(data);
}

/**
 * After a retry with a token minted moments ago, only a 401 or ACCESS_REVOKED ends the
 * session. A 403 from the error dispatch, a 510 or a 511 also come from a missing route,
 * a missing parameter or a server error, so they fail this request and nothing more.
 */
function endsSessionAfterRetry(status: number | undefined, data: unknown): boolean {
    return status === 401 || isRevoked(status, data);
}

/**
 * A 403 from the error dispatch is ambiguous: an expired token, or a route this backend
 * does not have. It refreshes at most once in this long, so a screen that keeps calling a
 * missing route does not refresh on every call. A 401 or an "Expired Token" body always
 * refreshes. The monotonic timer can stand still during deep sleep, so the gap is kept
 * short: at worst calls fail for this long after waking, and the session is kept.
 */
export const AMBIGUOUS_403_REFRESH_GAP_MS = 30_000;

function isAmbiguousDenial(status: number | undefined, data: unknown): boolean {
    const body = data as { error?: unknown; path?: unknown } | null;
    return (
        status === 403 &&
        body?.error === 'ACCESS_DENIED' &&
        body?.path === '/error' &&
        !bodySaysExpired(data)
    );
}

async function handleDeviceResponseError(error: AxiosError): Promise<unknown> {
    const status = error.response?.status;
    const config = error.config as PanelRequestConfig | undefined;
    if (status === 460) {
        handleSessionEnded('HTTP 460');
        throw error;
    }
    if (!config || skipsLogout(config) || !isDeviceAuthFailure(status, error.response?.data)) {
        throw error;
    }
    const sentWith = String(config.headers?.Authorization ?? '');
    const sentWithCurrent = sentWith === `Bearer ${getAccessToken() ?? ''}`;
    // This request went out under a session that is already gone: not this session's problem.
    const sentInGen = config.panelSessionGen;
    if (sentInGen === undefined ? !sentWithCurrent : sentInGen !== sessionGen) throw error;
    if (config.panelAuthRetried) {
        if (endsSessionAfterRetry(status, error.response?.data)) {
            handleSessionEnded(`HTTP ${status} after refresh`);
        }
        throw error;
    }
    // Same session, and another call has already refreshed since this one went out:
    // retry with that token rather than refreshing again.
    if (sentWithCurrent) {
        const since = msSinceLastRefresh();
        if (
            isAmbiguousDenial(status, error.response?.data) &&
            since !== null &&
            since < AMBIGUOUS_403_REFRESH_GAP_MS
        ) {
            throw error;
        }
        try {
            await refreshDeviceSession();
        } catch {
            // SESSION_ENDED was handled inside. Anything else keeps the session.
            throw error;
        }
    }
    config.panelAuthRetried = true;
    return panelApi.request(config);
}

function handleLegacyResponseError(error: AxiosError<{ error?: string } | undefined>): void {
    const status = error.response?.status;
    const config = error.config as PanelRequestConfig | undefined;
    if (status === 511 || (status === 401 && !skipsLogout(config))) {
        handleSessionEnded(`HTTP ${status}`);
    } else if (status === 403 && error.response?.data?.error === 'ACCESS_REVOKED') {
        handleSessionEnded('access revoked');
    }
}

panelApi.interceptors.response.use(
    (response) => response,
    (error: AxiosError<{ error?: string } | undefined>) => {
        if (!PANEL_LEGACY_LOGIN || usesDeviceAuth()) return handleDeviceResponseError(error);
        handleLegacyResponseError(error);
        // Always reject the AxiosError itself so callers can read status / data.
        return Promise.reject(error);
    }
);

export { panelApi };
export default panelApi;
