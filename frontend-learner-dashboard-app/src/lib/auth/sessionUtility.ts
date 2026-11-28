import axios, { type AxiosResponse } from "axios";
import { Preferences as Storage } from "@capacitor/preferences";
import { jwtDecode } from "jwt-decode";
import { REFRESH_TOKEN_URL, TERMINATE_CURRENT_SESSION } from "@/constants/urls";
import { resetOfflineAvailabilityCache } from "@/hooks/offline/use-offline-availability";
import { UnauthorizedResponse } from "@/constants/auth/unauthorizeresponse";
import { IAccessToken, TokenKey, Tokens } from "@/constants/auth/tokens";
import { isNullOrEmptyOrUndefined } from "../utils";
import Cookies from "js-cookie";

// Set token in cookie with domain support for cross-subdomain access
export const setAuthorizationCookie = (key: string, token: string): void => {
  // Do NOT set domain — let cookies scope to the exact hostname
  // so learner.vacademy.io and admin.vacademy.io stay independent
  Cookies.set(key, token, { expires: 7 });
};

// Get token from cookie
export const getTokenFromCookie = (tokenKey: string): string | null => {
  return Cookies.get(tokenKey) ?? null;
};

// Helper function to get a token from Capacitor Storage
const getTokenFromStorage = async (
  tokenKey: string
): Promise<string | null> => {
  // Try Capacitor Storage first
  const { value } = await Storage.get({ key: tokenKey });
  if (value) return value;

  // Fallback to localStorage only (cookies removed as per requirement)
  try {
    const localStorageValue = localStorage.getItem(tokenKey);
    if (localStorageValue) {
      console.log(
        `[SessionUtility] Token ${tokenKey} recovered from localStorage`
      );
      return localStorageValue;
    }
  } catch (error) {
    console.warn(`[SessionUtility] Failed to read from localStorage:`, error);
  }

  return null;
};

// Helper function to set a token in Capacitor Storage
const setTokenInStorage = async (key: string, token: string): Promise<void> => {
  // Store in Capacitor Preferences
  await Storage.set({
    key,
    value: token,
  });

  // Store in cookies for cross-subdomain access
  setAuthorizationCookie(key, token);

  // Also store in localStorage for synchronous access
  try {
    localStorage.setItem(key, token);
  } catch (error) {
    console.warn(`[SessionUtility] Failed to write to localStorage:`, error);
  }
};

// Helper function to get institute ID from Capacitor Storage with localStorage fallback
const getInstituteIdFromStorage = async (
  tokenKey: string
): Promise<string | null> => {
  // Try Capacitor Storage first
  const { value } = await Storage.get({ key: tokenKey });
  if (value) return value;

  // Fallback to localStorage
  try {
    const localStorageValue = localStorage.getItem(tokenKey);
    if (localStorageValue) {
      console.log(
        `[SessionUtility] InstituteId ${tokenKey} recovered from localStorage`
      );
      return localStorageValue;
    }
  } catch (error) {
    console.warn(
      `[SessionUtility] Failed to read InstituteId from localStorage:`,
      error
    );
  }

  return null;
};

// Helper function to set institute ID in Capacitor Storage, Cookies, and localStorage
const setInstituteIdInStorage = async (
  key: string,
  id: string
): Promise<void> => {
  // Store in Capacitor Preferences
  await Storage.set({
    key,
    value: id,
  });

  // Also store in cookies (scoped to exact hostname, not shared domain)
  Cookies.set(key, id, { expires: 7 });

  // Also store in localStorage for synchronous access
  try {
    localStorage.setItem(key, id);
  } catch (error) {
    console.warn(
      `[SessionUtility] Failed to write InstituteId to localStorage:`,
      error
    );
  }
};

// function to remove institute ID from Capacitor Storage
const removeInstituteIdFromStorage = async (): Promise<void> => {
  await Storage.remove({ key: "instituteId" });
};

// Check if a token is expired
const isTokenExpired = (token: string | null): boolean => {
  if (isNullOrEmptyOrUndefined(token)) {
    return true;
  }

  try {
    const tokenData = jwtDecode(token);

    if (!isNullOrEmptyOrUndefined(tokenData.exp)) {
      const expirationTime = new Date(tokenData.exp * 1000); // Convert seconds to milliseconds
      return expirationTime <= new Date(); // Check if expiration time is less than or equal to current time
    } else {
      // Expiration time not found in token, consider it expired
      return true;
    }
  } catch {
    // Malformed token — treat as expired so callers go through the
    // refresh/login path instead of crashing on the decode
    return true;
  }
};

// Decode token data
const getTokenDecodedData = (
  token: string | null
): IAccessToken | undefined => {
  if (isNullOrEmptyOrUndefined(token)) {
    return {
      user: "",
      email: "",
      is_root_user: false,
      authorities: {},
      username: "",
      sub: "",
      iat: 0,
      exp: 0,
    };
  }
  try {
    const tokenData: IAccessToken = jwtDecode(token);
    return tokenData;
  } catch (error) {
    console.warn("Failed to decode token:", error);
    return {
      user: "",
      email: "",
      is_root_user: false,
      authorities: {},
      username: "",
      sub: "",
      iat: 0,
      exp: 0,
    };
  }
};

// Refresh tokens
async function refreshTokens(
  refreshToken: string
): Promise<UnauthorizedResponse | Tokens> {
  const response: AxiosResponse<Tokens> = await axios({
    method: "GET",
    url: REFRESH_TOKEN_URL,
    params: { token: refreshToken },
  });

  // Store the new tokens in Capacitor Storage
  await setTokenInStorage(TokenKey.accessToken, response.data?.accessToken);
  await setTokenInStorage(TokenKey.refreshToken, response.data?.refreshToken);

  return response.data;
}

// Non-sensitive UI preferences that should survive logout.
const LOGOUT_PRESERVE_KEYS = ["theme-code", "theme-custom-color", "vite-ui-theme"];

// Expire every cookie on the current host AND every parent domain (so legacy
// `.vacademy.io`-scoped cookies are removed too).
const clearAllCookies = (): void => {
  try {
    const hostname = window.location.hostname;
    const domains = new Set<string>(["", hostname, ".vacademy.io"]);
    const parts = hostname.split(".");
    for (let i = 0; i < parts.length - 1; i += 1) {
      domains.add("." + parts.slice(i).join("."));
    }

    const cookies = document.cookie ? document.cookie.split("; ") : [];
    for (const cookie of cookies) {
      const eqIdx = cookie.indexOf("=");
      const name = (eqIdx > -1 ? cookie.slice(0, eqIdx) : cookie).trim();
      if (!name) continue;
      for (const domain of domains) {
        document.cookie =
          `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` +
          (domain ? `; domain=${domain}` : "");
      }
    }
  } catch {
    /* best-effort */
  }
};

// Wipe localStorage + sessionStorage, keeping only the UI-preference allowlist.
const clearWebStorage = (): void => {
  try {
    const preserved = LOGOUT_PRESERVE_KEYS.map(
      (key) => [key, localStorage.getItem(key)] as const
    );
    localStorage.clear();
    for (const [key, value] of preserved) {
      if (value !== null) localStorage.setItem(key, value);
    }
  } catch {
    /* best-effort — Safari private mode etc. */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* best-effort */
  }
};

// Drop browser-managed caches (Cache Storage + IndexedDB). Fire-and-forget.
const clearBrowserCaches = (): void => {
  try {
    if (typeof caches !== "undefined" && typeof caches.keys === "function") {
      void caches
        .keys()
        .then((names) => Promise.all(names.map((name) => caches.delete(name))))
        .catch(() => {});
    }
  } catch {
    /* best-effort */
  }
  try {
    const idb = window.indexedDB as unknown as {
      databases?: () => Promise<Array<{ name?: string | null }>>;
      deleteDatabase: (name: string) => unknown;
    };
    if (idb && typeof idb.databases === "function") {
      // Offline-content stores survive logout by design (plan B9): content is
      // encrypted with a per-user device-local key and unusable until the same
      // user logs back in. @capacitor-community/sqlite persists its web store
      // in IndexedDB under "jeepSqliteStore"; the DB itself is "vacademy_offline".
      const OFFLINE_DB_SKIP_LIST = ["jeepSqliteStore", "vacademy_offline"];
      void idb
        .databases()
        .then((dbs) => {
          dbs.forEach((db) => {
            if (db?.name && !OFFLINE_DB_SKIP_LIST.includes(db.name)) {
              idb.deleteDatabase(db.name);
            }
          });
        })
        .catch(() => {});
    }
  } catch {
    /* best-effort */
  }
};

// Remove ALL client-side session data and log out. Wipes tokens, every cookie,
// localStorage, sessionStorage, Capacitor Preferences and browser caches (Cache
// Storage + IndexedDB) so no previous user's data leaks into the next session on
// a shared device. Only the institute id (used for branding / course comparison
// after logout) and non-sensitive UI preferences (theme) are preserved.
const removeTokensAndLogout = async (): Promise<void> => {
  // The offline availability answer is institute-scoped and cached for the
  // session; a different learner (or institute) logging in on this device must
  // re-resolve it rather than inherit the previous one.
  resetOfflineAvailabilityCache();

  // Capture the institute id so we can restore it after the wipe.
  let preservedInstituteId: string | null = null;
  try {
    preservedInstituteId = await getInstituteIdFromStorage("InstituteId");
  } catch {
    /* ignore */
  }

  // Tell the backend to terminate this session using the still-valid token.
  // Fire-and-forget (short timeout) so a slow/unreachable backend never blocks
  // the local logout.
  try {
    const token = await getTokenFromStorage(TokenKey.accessToken);
    if (token) {
      void axios
        .post(TERMINATE_CURRENT_SESSION, null, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000,
        })
        .catch(() => {});
    }
  } catch {
    /* best-effort */
  }

  // 1. Capacitor Preferences — remove every key (native + web).
  try {
    const keys = await Storage.keys();
    await Promise.all(keys.keys.map((key) => Storage.remove({ key })));
  } catch {
    /* best-effort */
  }

  // 2. Cookies, 3. localStorage + sessionStorage, 4. browser caches.
  clearAllCookies();
  clearWebStorage();
  clearBrowserCaches();

  // 4b. Offline content: drop in-memory decryption keys and close the offline
  // DB. Encrypted content + SQLite rows deliberately survive (plan B9) — they
  // are keyed per user and unreadable without that user logging back in.
  // Dynamic imports keep the offline modules out of this hot path's bundle.
  try {
    const [{ clearKeyCache }, { closeOfflineDb }, { useOfflineStore }] = await Promise.all([
      import("@/lib/offline/crypto/keys"),
      import("@/lib/offline/db/connection"),
      import("@/stores/offline/use-offline-store"),
    ]);
    clearKeyCache();
    useOfflineStore.getState().reset();
    await closeOfflineDb();
  } catch {
    /* best-effort — offline feature may be unsupported on this platform */
  }

  // 5. Module-scope read memos holding user-specific responses (enrollments,
  // learner PII, user plan). In-SPA logouts don't reload the page, so without
  // this the next login on a shared device could be served the previous
  // user's cached data. Dynamic import: this module is imported by that
  // service, so a static import would be circular.
  try {
    const { clearUserScopedReadCaches } = await import(
      "@/services/user-enrollment-status"
    );
    clearUserScopedReadCaches();
  } catch {
    /* best-effort */
  }

  // The in-memory branding copy outlives the storage wipe above when the logout
  // does not reload the page. Same dynamic import reason as above.
  try {
    const { setCachedInstituteBranding } = await import(
      "@/services/domain-routing"
    );
    setCachedInstituteBranding(null);
  } catch {
    /* best-effort */
  }

  // Restore the preserved institute id into Capacitor + localStorage so
  // branding / course comparison still work on the login screen.
  if (preservedInstituteId) {
    try {
      await Storage.set({ key: "InstituteId", value: preservedInstituteId });
      localStorage.setItem("InstituteId", preservedInstituteId);
    } catch {
      /* ignore */
    }
  }

  console.log("User logged out.");
};

// Get access token from storage
export const getAccessToken = async () => {
  const { value } = await Storage.get({ key: "accessToken" });
  return value;
};

// Get refresh token from storage
export const getRefreshToken = async () => {
  const { value } = await Storage.get({ key: "refreshToken" });
  return value;
};

// Decode the current access token from storage
export async function getDecodedAccessTokenFromStorage(): Promise<
  IAccessToken | undefined
> {
  const token = await getAccessToken();
  return getTokenDecodedData(token);
}

// Convenience helpers to get current user details from stored token
export async function getCurrentUserId(): Promise<string | null> {
  const decoded = await getDecodedAccessTokenFromStorage();
  return decoded?.user ?? null;
}

export async function getCurrentUsername(): Promise<string | null> {
  const decoded = await getDecodedAccessTokenFromStorage();
  return decoded?.username ?? null;
}

export async function getCurrentEmail(): Promise<string | null> {
  const decoded = await getDecodedAccessTokenFromStorage();
  return decoded?.email ?? null;
}

const handleSSOLogin = (): boolean => {
  const urlParams = new URLSearchParams(window.location.search);
  const isSSOLogin = urlParams.get("sso") === "true";
  if (!isSSOLogin) return false;

  const accessToken = urlParams.get("accessToken");
  const refreshToken = urlParams.get("refreshToken");
  const redirectPath = urlParams.get("redirect");
  try {
    if (accessToken && refreshToken && !isTokenExpired(accessToken)) {
      // Set tokens in cookies
      setTokenInStorage(TokenKey.accessToken, accessToken);
      setTokenInStorage(TokenKey.refreshToken, refreshToken);
      setAuthorizationCookie(TokenKey.accessToken, accessToken);
      setAuthorizationCookie(TokenKey.refreshToken, refreshToken);

      // Clean up URL
      const cleanUrl =
        window.location.pathname +
        (redirectPath ? `?redirect=${redirectPath}` : "");
      window.history.replaceState({}, document.title, cleanUrl);
      return true;
    } else {
      console.error("Decrypted tokens are invalid or expired");
      return false;
    }
  } catch (error) {
    console.error("Error decrypting SSO tokens:", error);
    return false;
  }
};

/**
 * True when this device holds a usable learner session (token + the cached
 * student/institute records the app needs to render an authenticated screen).
 *
 * Mirrors the check __root.tsx runs on every navigation. It lives here so the
 * reader-mode route guards can ask the same question WITHOUT importing
 * __root.tsx (that would be a circular import: __root is the parent of every
 * route in the generated tree).
 *
 * Why the guards must ask at all: the reader-mode gates send blocked learners
 * to /dashboard, which is an authenticated route. For a logged-OUT learner that
 * bounces off __root's auth check straight back to the institute landing route,
 * which is itself reader-blocked on iOS — an infinite redirect loop that pins
 * the app on the boot splash forever. Send logged-out learners to /login.
 */
const hasActiveLearnerSession = async (): Promise<boolean> => {
  try {
    const token = await getTokenFromStorage(TokenKey.accessToken);
    const studentDetails = await Storage.get({ key: "StudentDetails" });
    const instituteDetails = await Storage.get({ key: "InstituteDetails" });

    return (
      !isNullOrEmptyOrUndefined(token) &&
      !isNullOrEmptyOrUndefined(studentDetails?.value) &&
      !isNullOrEmptyOrUndefined(instituteDetails?.value)
    );
  } catch (error) {
    // Storage unavailable — treat as logged out. /login is always reachable,
    // so this can never strand the learner the way /dashboard can.
    console.error("[auth] session check failed:", error);
    return false;
  }
};

export {
  refreshTokens,
  removeTokensAndLogout,
  setTokenInStorage,
  getTokenFromStorage,
  isTokenExpired,
  getTokenDecodedData,
  // exports for institute ID management
  setInstituteIdInStorage,
  getInstituteIdFromStorage,
  removeInstituteIdFromStorage,
  handleSSOLogin,
  hasActiveLearnerSession,
};
