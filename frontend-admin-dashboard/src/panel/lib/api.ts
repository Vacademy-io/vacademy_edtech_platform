/**
 * panelApi — the panel's authenticated axios instance.
 *
 * vite.panel.config.ts redirects every import of src/lib/auth/axiosInstance.ts
 * to this file, so reused admin services get it too (default export, same as
 * the admin instance).
 *
 * Differences from the admin instance (deliberate):
 * - Refresh uses the CORRECT backend contract: POST REFRESH_TOKEN_URL {token}
 *   → {accessToken} only (AuthManager.refreshToken). The refresh token is kept
 *   and both cookies are re-written to extend their 7-day life. Single-flight.
 *   It runs when the access JWT is within REFRESH_SKEW_MS (24 h) of expiry.
 * - On 401 / 511 / 403 ACCESS_REVOKED it clears ONLY the two auth cookies
 *   (never removeCookiesAndLogout, which wipes all localStorage) and sends the
 *   user to #/login when the current screen needs a session.
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
import { PANEL_BLOCKED_ROLE, REFRESH_SKEW_MS, SHARED_STORAGE_KEYS } from '../config';
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
    setAuthCookies(accessToken, refreshToken);
    notifySessionChanged();
}

/**
 * Sign-out storage effect: removes ONLY the two auth cookies. Keeps every
 * panel.* key, selectedInstituteId and the theme keys. New session generation,
 * so an in-flight refresh cannot write the cookies back.
 */
export function clearPanelSession(): void {
    sessionGen++;
    refreshInFlight = null;
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
    const valid = getPanelValidInstituteIds();
    const selected = readString(SHARED_STORAGE_KEYS.selectedInstituteId);
    if (selected && valid.indexOf(selected) >= 0) return selected;
    return valid[0] ?? null;
}

// ---------------------------------------------------------------- refresh ---

/** Thrown when the session changed (sign-out / another sign-in) while a refresh was in flight. */
const SESSION_CHANGED = 'SESSION_CHANGED';

/**
 * POST REFRESH_TOKEN_URL {token: refreshToken} → new access token. Concurrent
 * callers share one request. Rejects when there is no refresh token or the
 * backend refuses (403 = token unknown / access revoked).
 */
export function refreshAccessToken(): Promise<string> {
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
}

const panelApi = axios.create();

panelApi.interceptors.request.use(async (config) => {
    let accessToken = getAccessToken();
    if (!accessToken) {
        handleSessionEnded('no access token');
        throw new Error('Not signed in');
    }

    const remaining = msUntilExpiry(accessToken);
    if (remaining === null || remaining < REFRESH_SKEW_MS) {
        try {
            accessToken = await refreshAccessToken();
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

    config.headers.Authorization = `Bearer ${accessToken}`;
    if (!config.headers.clientId) {
        const instituteId = getInstituteIdForRequests();
        if (instituteId) config.headers.clientId = instituteId;
    }
    if (!config.headers['Accept-Language']) {
        config.headers['Accept-Language'] =
            i18next.language || readString(SHARED_STORAGE_KEYS.locale) || 'en';
    }
    return config;
});

function skipsLogout(config?: PanelRequestConfig): boolean {
    if (!config) return false;
    if (config.skipAuthLogout) return true;
    return (config.url ?? '').indexOf('/ai-service') >= 0;
}

panelApi.interceptors.response.use(
    (response) => response,
    (error: AxiosError<{ error?: string } | undefined>) => {
        const status = error.response?.status;
        const config = error.config as PanelRequestConfig | undefined;
        if (status === 511 || (status === 401 && !skipsLogout(config))) {
            handleSessionEnded(`HTTP ${status}`);
        } else if (status === 403 && error.response?.data?.error === 'ACCESS_REVOKED') {
            handleSessionEnded('access revoked');
        }
        // Always reject the AxiosError itself so callers can read status / data.
        return Promise.reject(error);
    }
);

export { panelApi };
export default panelApi;
