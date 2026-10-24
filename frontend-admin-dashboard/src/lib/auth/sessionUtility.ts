import axios, { type AxiosResponse } from 'axios';
import Cookies from 'js-cookie';
import { jwtDecode } from 'jwt-decode';
import { REFRESH_TOKEN_URL } from '@/constants/urls';
import { UnauthorizedResponse } from '@/constants/auth/unauthorizeresponse';
import { IAccessToken, TokenKey, Tokens } from '@/constants/auth/tokens';
import { isNullOrEmptyOrUndefined } from '../utils';

// SSO Configuration
const SSO_CONFIG = {
    ADMIN_DOMAIN: import.meta.env.VITE_ADMIN_DOMAIN || 'dash.vacademy.io',
    LEARNER_DOMAIN: import.meta.env.VITE_LEARNER_DOMAIN || 'learner.vacademy.io/login',
    SHARED_DOMAIN: import.meta.env.VITE_SHARED_DOMAIN || '.vacademy.io', // Shared cookie domain
    REQUIRED_ROLES: {
        ADMIN: ['ADMIN', 'TEACHER'],
        LEARNER: ['STUDENT'],
    },
};

// Get token from cookie
const getTokenFromCookie = (tokenKey: string): string | null => {
    return Cookies.get(tokenKey) ?? null;
};

// Set token in cookie with domain support
const setAuthorizationCookie = (
    key: string,
    token: string,
    options?: Cookies.CookieAttributes
): void => {
    const isProduction = window.location.hostname.includes(
        import.meta.env.VITE_SHARED_DOMAIN?.replace('.', '') || 'vacademy.io'
    );

    const defaultOptions: Cookies.CookieAttributes = {
        // Do NOT set domain — let cookies scope to the exact hostname
        // so admin.vacademy.io and learner.vacademy.io stay independent
        secure: isProduction,
        sameSite: 'lax',
        expires: 7, // 7 days
    };

    console.log('Setting cookie:', key, 'with options:', defaultOptions);
    Cookies.set(key, token, { ...defaultOptions, ...options });

    // Verify cookie was set
    const verifySet = Cookies.get(key);
    console.log('Cookie verification:', key, verifySet ? 'SUCCESS' : 'FAILED');

    // If we just set the access token, identify the user in Amplitude
    if (key === TokenKey.accessToken) {
        try {
            const tokenData = getTokenDecodedData(token);
            const userId = tokenData?.user as string | undefined;
            if (typeof window !== 'undefined' && userId) {
                // Defer import to avoid circular deps and keep login snappy
                setTimeout(() => {
                    import('@/lib/amplitude')
                        .then(({ identifyUser, initializeAmplitude }) => {
                            // Ensure Amplitude is initialized before identify
                            try {
                                initializeAmplitude();
                            } catch (initError) {
                                // Ignore initialization errors for analytics
                                console.debug('[Amplitude] init error (ignored):', initError);
                            }
                            identifyUser(userId, {
                                email: (tokenData as IAccessToken | undefined)?.email ?? null,
                                username: (tokenData as IAccessToken | undefined)?.username ?? null,
                            });
                        })
                        .catch(() => {
                            // Analytics failure shouldn't block auth flow
                        });
                }, 0);
            }
        } catch (e) {
            // Non-fatal if token can't be decoded
        }
    }
};

// Alias to support `setTokenInStorage` as a wrapper for consistency
const setTokenInStorage = async (key: string, token: string): Promise<void> => {
    setAuthorizationCookie(key, token);
};

// Check if token is expired
const isTokenExpired = (token: string | null): boolean => {
    if (isNullOrEmptyOrUndefined(token)) return true;

    try {
        const tokenData = jwtDecode(token);
        if (!isNullOrEmptyOrUndefined(tokenData.exp)) {
            const expirationTime = new Date(tokenData.exp * 1000);
            return expirationTime <= new Date();
        }
    } catch (error) {
        console.error('Error decoding token:', error);
        return true;
    }
    return true;
};

// Decode token
const getTokenDecodedData = (token: string | null): IAccessToken | undefined => {
    if (isNullOrEmptyOrUndefined(token)) return;
    try {
        return jwtDecode(token);
    } catch (error) {
        console.error('Error decoding token:', error);
        return undefined;
    }
};

// Check if user has specific roles
const hasRole = (tokenData: IAccessToken, roles: string[]): boolean => {
    if (!tokenData.authorities) return false;

    // Check all authorities for the required roles
    for (const authority of Object.values(tokenData.authorities)) {
        if (authority.roles && authority.roles.some((role) => roles.includes(role))) {
            return true;
        }
    }
    return false;
};

// Check if user can access admin dashboard
const canAccessAdminDashboard = (token: string | null): boolean => {
    if (!token || isTokenExpired(token)) return false;

    const tokenData = getTokenDecodedData(token);
    if (!tokenData) return false;

    return hasRole(tokenData, SSO_CONFIG.REQUIRED_ROLES.ADMIN);
};

// Check if user can access learner platform
const canAccessLearnerPlatform = (token: string | null): boolean => {
    if (!token || isTokenExpired(token)) return false;

    const tokenData = getTokenDecodedData(token);
    if (!tokenData) return false;

    return hasRole(tokenData, SSO_CONFIG.REQUIRED_ROLES.LEARNER);
};

// Get user roles from token
const getUserRoles = (token: string | null): string[] => {
    if (!token || isTokenExpired(token)) return [];

    const tokenData = getTokenDecodedData(token);
    if (!tokenData || !tokenData.authorities) return [];

    const roles: string[] = [];
    for (const authority of Object.values(tokenData.authorities)) {
        if (authority.roles) {
            roles.push(...authority.roles);
        }
    }

    return [...new Set(roles)]; // Remove duplicates
};

// Generate SSO URL with tokens for cross-domain authentication
const generateSSOUrl = (targetDomain: string, redirectPath?: string): string | null => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const refreshToken = getTokenFromCookie(TokenKey.refreshToken);

    if (!accessToken || !refreshToken || isTokenExpired(accessToken)) {
        return null;
    }

    const baseUrl = `https://${targetDomain}`;
    const params = new URLSearchParams({
        sso: 'true',
        accessToken: accessToken,
        refreshToken: refreshToken,
        ...(redirectPath && { redirect: redirectPath }),
    });

    // Never put this URL on the clipboard: it carries live access + refresh tokens, and a
    // clipboard is readable by other apps and survives into whatever gets pasted next.
    return `${baseUrl}?${params.toString()}`;
};

// Handle SSO login from URL parameters
const handleSSOLogin = (): boolean => {
    const urlParams = new URLSearchParams(window.location.search);
    const isSSOLogin = urlParams.get('sso') === 'true';

    if (!isSSOLogin) return false;

    const accessToken = urlParams.get('accessToken');
    const refreshToken = urlParams.get('refreshToken');
    const redirectPath = urlParams.get('redirect');

    if (accessToken && refreshToken && !isTokenExpired(accessToken)) {
        try {
            setAuthorizationCookie(TokenKey.accessToken, accessToken);
            setAuthorizationCookie(TokenKey.refreshToken, refreshToken);

            const cleanUrl =
                window.location.pathname + (redirectPath ? `?redirect=${redirectPath}` : '');
            window.history.replaceState({}, document.title, cleanUrl);

            return true;
        } catch (error) {
            console.error('Error decrypting SSO tokens:', error);
            return false;
        }
    }
    return false;
};

// Refresh tokens and update cookies
async function refreshTokens(refreshToken: string): Promise<UnauthorizedResponse | Tokens> {
    console.log('[Token Refresh] Starting token refresh...');

    try {
        const response: AxiosResponse<Tokens> = await axios({
            method: 'GET',
            url: REFRESH_TOKEN_URL,
            params: { token: refreshToken },
            timeout: 10000, // 10 second timeout
        });

        console.log('[Token Refresh] Refresh response received:', {
            status: response.status,
            hasAccessToken: !!response.data?.accessToken,
            hasRefreshToken: !!response.data?.refreshToken,
        });

        if (!response.data?.accessToken || !response.data?.refreshToken) {
            throw new Error('Invalid response from token refresh endpoint');
        }

        await setTokenInStorage(TokenKey.accessToken, response.data.accessToken);
        await setTokenInStorage(TokenKey.refreshToken, response.data.refreshToken);

        console.log('[Token Refresh] Tokens stored successfully');
        return response.data;
    } catch (error) {
        console.error('[Token Refresh] Failed to refresh tokens:', error);

        if (axios.isAxiosError(error)) {
            console.error('[Token Refresh] Axios error details:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message,
            });

            // If it's a 511 error, this might indicate a network-level auth issue
            if (error.response?.status === 511) {
                throw new Error(
                    'Network authentication required. Please check your connection and try again.'
                );
            }
        }

        throw error;
    }
}

// Non-sensitive UI preferences that should survive logout (so the next visit
// keeps the user's chosen theme, table layout, etc.). Everything else in
// localStorage is wiped.
// `current_domain_branding` is the PUBLIC white-label config of the host
// (name/logo/theme/auth toggles) — it comes from an unauthenticated endpoint and
// carries no user data, so wiping it only made the login page we redirect to lose
// the institute name and T&C/Privacy links (the redirect is client-side, so
// index.tsx's bootstrap never re-runs to refetch it).
const LOGOUT_PRESERVE_KEYS = [
    'theme-code',
    'theme-custom-color',
    'vite-ui-theme',
    'current_domain_branding',
];
// Key PREFIXES whose entries also survive logout — per-surface layout choices
// such as the leads "Manage Column" show/hide (crm-lead-columns:<surface>).
// `crm-saved-views:` = a person's saved Recent Leads filter views, keyed by institute + user.
const LOGOUT_PRESERVE_PREFIXES = ['crm-lead-columns:', 'crm-saved-views:'];

// Expire every cookie visible to this document on the current host AND every
// parent domain (so legacy `.vacademy.io`-scoped cookies are removed too).
const clearAllCookies = (): void => {
    try {
        const hostname = window.location.hostname;
        const domains = new Set<string>(['', hostname, SSO_CONFIG.SHARED_DOMAIN]);
        const parts = hostname.split('.');
        for (let i = 0; i < parts.length - 1; i += 1) {
            domains.add('.' + parts.slice(i).join('.'));
        }

        const cookies = document.cookie ? document.cookie.split('; ') : [];
        for (const cookie of cookies) {
            const eqIdx = cookie.indexOf('=');
            const name = (eqIdx > -1 ? cookie.slice(0, eqIdx) : cookie).trim();
            if (!name) continue;
            for (const domain of domains) {
                document.cookie =
                    `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` +
                    (domain ? `; domain=${domain}` : '');
            }
        }
    } catch (_err) {
        /* best-effort */
    }
};

// Wipe localStorage + sessionStorage, keeping only the UI-preference allowlist.
const clearWebStorage = (): void => {
    try {
        const preserved = LOGOUT_PRESERVE_KEYS.map(
            (key) => [key, localStorage.getItem(key)] as const
        );
        // Also carry over any prefixed layout/preference keys (e.g. per-surface
        // Manage Column choices) so they survive logout → login.
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key && LOGOUT_PRESERVE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
                preserved.push([key, localStorage.getItem(key)] as const);
            }
        }
        localStorage.clear();
        for (const [key, value] of preserved) {
            if (value !== null) localStorage.setItem(key, value);
        }
    } catch (_err) {
        /* best-effort — Safari private mode etc. */
    }
    try {
        sessionStorage.clear();
    } catch (_err) {
        /* best-effort */
    }
};

// Drop browser-managed caches: Cache Storage (PWA/service-worker) and IndexedDB.
// Fire-and-forget — logout navigation must not block on these.
const clearBrowserCaches = (): void => {
    try {
        if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
            void caches
                .keys()
                .then((names) => Promise.all(names.map((name) => caches.delete(name))))
                .catch(() => {});
        }
    } catch (_err) {
        /* best-effort */
    }
    try {
        const idb = window.indexedDB as unknown as {
            databases?: () => Promise<Array<{ name?: string | null }>>;
            deleteDatabase: (name: string) => unknown;
        };
        if (idb && typeof idb.databases === 'function') {
            void idb
                .databases()
                .then((dbs) => {
                    dbs.forEach((db) => {
                        if (db?.name) idb.deleteDatabase(db.name);
                    });
                })
                .catch(() => {});
        }
    } catch (_err) {
        /* best-effort */
    }
};

// Clear ALL client-side session data on logout: auth cookies, every other
// cookie, localStorage, sessionStorage and browser caches (Cache Storage +
// IndexedDB). Centralised so every logout entry-point (navbar, vimotion sidebar,
// forced 401 logout) wipes the same data — no previous user's state leaks into
// the next session on a shared browser. Only a small allowlist of non-sensitive
// UI preferences (theme) is preserved. The full localStorage wipe also removes
// the old sub-org faculty cache (faculty_access_data / selected_suborg_id).
const removeCookiesAndLogout = (): void => {
    // Remove auth tokens via js-cookie first (matches how they were set).
    Cookies.remove(TokenKey.accessToken);
    Cookies.remove(TokenKey.refreshToken);
    Cookies.remove(TokenKey.accessToken, { domain: SSO_CONFIG.SHARED_DOMAIN });
    Cookies.remove(TokenKey.refreshToken, { domain: SSO_CONFIG.SHARED_DOMAIN });

    // Then wipe everything else.
    clearAllCookies();
    clearWebStorage();
    clearBrowserCaches();
};

// Debug function to check token status
const debugTokenStatus = (): void => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const refreshToken = getTokenFromCookie(TokenKey.refreshToken);

    console.log('[Token Debug] Current token status:', {
        hasAccessToken: !!accessToken,
        accessTokenLength: accessToken?.length || 0,
        hasRefreshToken: !!refreshToken,
        refreshTokenLength: refreshToken?.length || 0,
        isAccessTokenExpired: isTokenExpired(accessToken),
        accessTokenData: accessToken ? getTokenDecodedData(accessToken) : null,
    });
};

export {
    refreshTokens,
    removeCookiesAndLogout,
    setAuthorizationCookie,
    getTokenFromCookie,
    isTokenExpired,
    getTokenDecodedData,
    setTokenInStorage,
    hasRole,
    canAccessAdminDashboard,
    canAccessLearnerPlatform,
    getUserRoles,
    generateSSOUrl,
    handleSSOLogin,
    debugTokenStatus,
    SSO_CONFIG,
};
