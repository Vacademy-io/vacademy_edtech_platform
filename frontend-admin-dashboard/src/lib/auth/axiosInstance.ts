import { TokenKey } from '@/constants/auth/tokens';
import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import * as Sentry from '@sentry/react';
import { getInstituteId } from '@/constants/helper';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
// Locale helper only (reads the zustand store lazily at request time) — no
// import cycle: formatters → language store → i18n/locales, none touch axios.
import { getActiveLocale } from '@/lib/formatters';
import { recordApiSample } from '@/lib/perf/network-health';
import { handleAiUsageLimitError, handleAiUsageWarningResponse } from '@/lib/ai-usage-limit';
import {
    getTokenFromCookie,
    isTokenExpired,
    refreshTokens,
    removeCookiesAndLogout,
    debugTokenStatus,
} from './sessionUtility';

const authenticatedAxiosInstance = axios.create();

/**
 * Request timing for the "is it us or your connection?" indicator. The start
 * stamp rides on the config object so the response interceptor can close the
 * loop. Every call below is wrapped: latency measurement must never be able to
 * break an actual request, least of all one on the auth path.
 */
type TimedRequestConfig = InternalAxiosRequestConfig & { __perfStartedAt?: number };

const stampPerfStart = (request: InternalAxiosRequestConfig) => {
    try {
        (request as TimedRequestConfig).__perfStartedAt = performance.now();
    } catch {
        // ignore
    }
};

const recordPerfSample = (
    config: TimedRequestConfig | undefined,
    status: number | undefined,
    headers: unknown
) => {
    try {
        const startedAt = config?.__perfStartedAt;
        if (typeof startedAt !== 'number') return;
        const url = config?.url;
        if (!url) return;

        // axios lowercases response header keys.
        const serverTiming =
            headers && typeof headers === 'object'
                ? ((headers as Record<string, unknown>)['server-timing'] as string | undefined)
                : undefined;

        recordApiSample({
            url,
            totalMs: performance.now() - startedAt,
            serverTimingHeader: serverTiming ?? null,
            status: status ?? 0,
        });
    } catch {
        // ignore
    }
};

// Every call below ends in removeCookiesAndLogout() — a destructive logout the
// user experiences as "the app kicked me out". These must be visible in Sentry
// so an auth-service outage (everyone logged out at once) is distinguishable
// from normal session expiry. Stable messages keep grouping clean; specifics go
// in tags/extra.
const captureForcedLogout = (
    message: string,
    options: { level?: Sentry.SeverityLevel; error?: unknown; extra?: Record<string, unknown> } = {}
) => {
    try {
        if (!Sentry.getClient()) return;
        Sentry.withScope((scope) => {
            scope.setLevel(options.level ?? 'warning');
            scope.setTag('feature', 'auth');
            scope.setTag('auth.forced_logout', 'true');
            if (options.extra) scope.setContext('Auth Failure', options.extra);
            if (options.error) scope.setExtra('originalError', String(options.error));
            Sentry.captureMessage(message);
        });
    } catch {
        // Never let Sentry instrumentation break the auth flow itself.
    }
};

// A 401 from the AI service does NOT mean the user's session is dead. The AI
// service (FastAPI) validates JWTs with its own secret, so an auth-service
// issued token can be rejected there with {"detail":"Could not validate
// credentials"} while the rest of the app is perfectly authenticated. Calling
// removeCookiesAndLogout() in that case clears the session cookies mid-session,
// which then makes every other in-flight authenticated request fail and the
// navbar's useSuspenseQuery calls throw into the root error boundary
// ("Something went wrong"). Skip the global logout for such 401s — and let any
// caller opt out explicitly via `config.skipAuthLogout`.
const shouldSkipAuthLogout = (config?: InternalAxiosRequestConfig): boolean => {
    if (!config) return false;
    if ((config as { skipAuthLogout?: boolean }).skipAuthLogout) return true;
    const url = config.url ?? '';
    return url.includes('/ai-service') || url.startsWith(AI_SERVICE_BASE_URL);
};

// Debug function that can be called from browser console
const debugAuthStatus = () => {
    debugTokenStatus();
};

// Attach debug function to window for console access
if (typeof window !== 'undefined') {
    (window as any).debugAuth = debugAuthStatus;
}

authenticatedAxiosInstance.interceptors.request.use(
    async (request) => {
        let accessToken = getTokenFromCookie(TokenKey.accessToken);

        if (!accessToken) {
            console.error('[Axios Request] No access token found');
            captureForcedLogout('Forced logout: no access token on authenticated request', {
                extra: { requestUrl: request.url },
            });
            removeCookiesAndLogout();
            return Promise.reject(new Error('No access token found'));
        }

        if (isTokenExpired(accessToken)) {
            const refreshToken = getTokenFromCookie(TokenKey.refreshToken);

            if (!refreshToken) {
                console.error('[Axios Request] No refresh token found');
                removeCookiesAndLogout();
                return Promise.reject(new Error('Refresh token missing or expired'));
            }

            try {
                await refreshTokens(refreshToken); // This should also update the cookies
                accessToken = getTokenFromCookie(TokenKey.accessToken); // Get the new token
            } catch (error) {
                console.error('[Axios Request] Token refresh failed:', error);
                // A 4xx means the session is genuinely dead (expected expiry);
                // anything else (network, timeout, 5xx) is a transient failure
                // that just destroyed a valid session — that's an error.
                const status = axios.isAxiosError(error) ? error.response?.status : undefined;
                const isTransient = status === undefined || status >= 500;
                captureForcedLogout('Forced logout: token refresh failed', {
                    level: isTransient ? 'error' : 'warning',
                    error,
                    extra: { requestUrl: request.url, refreshStatus: status ?? 'no-response' },
                });
                removeCookiesAndLogout();
                return Promise.reject(new Error('Token refresh failed'));
            }
        }

        // Now that token is valid, attach it to headers
        request.headers.Authorization = `Bearer ${accessToken}`;

        // Attach institute id as `clientId` header. Backend's JwtAuthFilter
        // composes its user-lookup key as `${clientId}@${username}`; without
        // it the user-details cache key is wrong AND services like the audit
        // log (which require institute_id NOT NULL) end up dropping events.
        // Don't overwrite if the caller already set it explicitly.
        if (!request.headers.clientId) {
            const instituteId = getInstituteId();
            if (instituteId) {
                request.headers.clientId = instituteId;
            }
        }

        // Advertise the user's UI locale so backend services can localize
        // responses (validation messages, notifications) as i18n rolls out.
        if (!request.headers['Accept-Language']) {
            request.headers['Accept-Language'] = getActiveLocale();
        }

        stampPerfStart(request);

        return request;
    },

    async (error) => {
        console.error('[Axios Request] Request interceptor error:', error);
        return Promise.reject(error);
    }
);

// Add response interceptor to handle authentication errors
authenticatedAxiosInstance.interceptors.response.use(
    (response) => {
        recordPerfSample(response.config as TimedRequestConfig, response.status, response.headers);
        // Soft AI usage-limit warning (X-AI-Usage-Warning) -> one toast per use case
        // per session. Read-only on the response; never throws.
        handleAiUsageWarningResponse(response.headers);
        return response;
    },
    async (error) => {
        const { response } = error;

        // Failures are measured too. A timeout or a 500 under load is exactly the
        // condition the indicator exists to describe, so dropping these samples
        // would blind it precisely when things are going wrong.
        recordPerfSample(
            error?.config as TimedRequestConfig | undefined,
            response?.status,
            response?.headers
        );

        // Only log non-403 errors to reduce noise
        if (response?.status !== 403) {
            console.error('[Axios Response] Request failed:', {
                url: error.config?.url,
                status: response?.status,
                statusText: response?.statusText,
                data: response?.data,
            });
        }

        // An AI call refused by an institute/platform usage limit (429 with
        // error AI_USAGE_LIMIT): open the "limit reached" modal, then reject the
        // original error as before. Any other 429 is untouched.
        if (response?.status === 429) {
            await handleAiUsageLimitError(error);
            return Promise.reject(error);
        }

        // Handle 511 Network Authentication Required
        if (response?.status === 511) {
            const responseData = response?.data;

            // Check if it's actually a backend error message disguised as 511
            // Sometimes backend returns 511 for business logic errors which should NOT log the user out
            if (responseData && (responseData.ex || responseData.responseCode)) {
                console.warn('[Axios Response] 511 Error with backend exception details - NOT logging out:', responseData);
                // Return the error as is so the calling service can handle the specific error message
                return Promise.reject(error);
            }

            // Handle blob responses (e.g. from requests with responseType: 'blob')
            if (responseData instanceof Blob) {
                try {
                    const text = await responseData.text();
                    const json = JSON.parse(text);
                    if (json.ex || json.responseCode) {
                        console.warn('[Axios Response] 511 Blob error with backend exception - NOT logging out:', json);
                        return Promise.reject(new Error(json.ex || json.responseCode));
                    }
                } catch {
                    // Not valid JSON, fall through to logout
                }
            }

            console.error(
                '[Axios Response] 511 Network Authentication Required - Token may be invalid or expired'
            );
            console.error('[Axios Response] Response data:', response.data);
            console.error('[Axios Response] Running auth debug...');
            debugAuthStatus();
            captureForcedLogout('Forced logout: 511 from backend', {
                extra: { requestUrl: error.config?.url, responseData: response?.data },
            });
            removeCookiesAndLogout();
            return Promise.reject(
                new Error('Network authentication required. Please log in again.')
            );
        }

        // Handle 401 Unauthorized
        if (response?.status === 401) {
            // A 401 carrying a structured backend body is a business rejection an endpoint chose
            // ("Authentication required" from a widget/support/roadmap controller), NOT a dead
            // session — the same distinction the 511 branch above already draws. A genuinely
            // expired token never lands here: JwtAuthFilter throws VacademyException("Expired
            // Token"), which is a 510. Logging out on these would end the session over one
            // endpoint's own permission check.
            const structured = response?.data;
            if (
                structured &&
                typeof structured === 'object' &&
                (structured.ex || structured.responseCode || structured.message)
            ) {
                console.warn(
                    '[Axios Response] 401 with backend exception details - NOT logging out:',
                    structured
                );
                return Promise.reject(error);
            }

            // A 401 from the AI service (separate auth) must not log the user
            // out of the whole app — reject so the local caller can handle it.
            if (shouldSkipAuthLogout(error.config)) {
                console.warn(
                    '[Axios Response] 401 from a separately-authenticated endpoint — NOT logging out:',
                    error.config?.url
                );
                return Promise.reject(error);
            }
            console.error('[Axios Response] 401 Unauthorized - Token is invalid');
            console.error('[Axios Response] Response data:', response.data);
            captureForcedLogout('Forced logout: 401 on authenticated request', {
                extra: { requestUrl: error.config?.url, responseData: response?.data },
            });
            removeCookiesAndLogout();
            return Promise.reject(new Error('Authentication failed. Please log in again.'));
        }

        // Handle 403 Forbidden
        if (response?.status === 403) {
            // An admin disabled or removed this member ("Disable access" / "Delete member" on
            // Teams). The backend sends this code only for that case — never for an
            // auth-service blip — so it is safe to end the session here.
            if (response?.data?.error === 'ACCESS_REVOKED') {
                captureForcedLogout('Forced logout: team access revoked', {
                    level: 'info',
                    extra: { requestUrl: error.config?.url },
                });
                removeCookiesAndLogout();
                return Promise.reject(
                    new Error('Your access to this institute has been disabled.')
                );
            }
            // Don't log 403 errors as they're expected for some institute details requests.
            //
            // Reject the AxiosError itself rather than a bare Error. A 403 is how the backend says
            // WHY it refused — chat's CHAT_DISABLED / DM_NOT_ALLOWED, an audience report the caller
            // isn't scoped to — and replacing it dropped `response.status` and `response.data` on
            // the floor, so every caller checking `error.response?.status === 403` was dead code and
            // reason codes could never be read. The friendly sentence is kept as the error's own
            // message, which is all the replacement ever carried, so `err.message` callers are
            // unaffected.
            error.message = 'You do not have permission to perform this action.';
            return Promise.reject(error);
        }

        // Handle other authentication-related errors
        if (response?.status >= 500 && response?.status < 600) {
            console.error(`[Axios Response] Server error ${response.status}:`, response.data);
            // If the backend included a structured error body — a Vacademy
            // exception (ex / responseCode) or a FastAPI ai_service body
            // ({detail}) — preserve the original AxiosError so callers can
            // surface the actual error message. Without this the helpful
            // backend message gets replaced by a generic toast.
            const responseData = response?.data;
            if (responseData && (responseData.ex || responseData.responseCode || responseData.detail)) {
                return Promise.reject(error);
            }
            return Promise.reject(new Error('Server error. Please try again later.'));
        }

        return Promise.reject(error);
    }
);

export default authenticatedAxiosInstance;
