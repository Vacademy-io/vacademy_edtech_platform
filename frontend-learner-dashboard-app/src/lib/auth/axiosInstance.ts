import { Preferences } from "@capacitor/preferences";
import { TokenKey } from "@/constants/auth/tokens";
import axios from "axios";
import * as Sentry from "@sentry/react";
import {
  isTokenExpired,
  removeTokensAndLogout,
  getTokenFromStorage,
} from "./sessionUtility";
import { REFRESH_TOKEN_URL, VALIDATE_SESSION } from "@/constants/urls";
import { maybeServeFromCache, maybeStoreInCache } from "@/lib/http/clientCache";
import { getActiveLocale } from "@/lib/formatters";
import { toast } from "sonner";
import { getAiUsageLimitFromError } from "@/lib/ai-usage-limit";
import {
  notifyAiUsageWarning,
  scheduleAiUsageLimitToast,
} from "@/lib/ai-usage-limit-notify";

let isHandlingSessionTermination = false;

// ── Sentry: auth-path captures, throttled per message so a burst of parallel
// requests during a single outage doesn't fan out into dozens of identical
// events. Stable messages keep grouping clean; specifics go in context. ──
const AUTH_CAPTURE_THROTTLE_MS = 60 * 1000;
const lastAuthCaptureAt = new Map<string, number>();
const captureAuthEvent = (
  message: string,
  level: "warning" | "error",
  extra?: Record<string, unknown>,
) => {
  if (import.meta.env.VITE_ENABLE_SENTRY !== "true") return;
  const now = Date.now();
  if (now - (lastAuthCaptureAt.get(message) ?? 0) < AUTH_CAPTURE_THROTTLE_MS)
    return;
  lastAuthCaptureAt.set(message, now);
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setTag("feature", "auth");
    if (extra) scope.setContext("Auth Failure", extra);
    Sentry.captureMessage(message);
  });
};

// Throttle 5xx captures to one per (status + URL path) per minute. A recurring
// server error otherwise fires one event per request per user — a flood that
// burns the errors quota and trips spike protection — while telling us nothing
// the first event didn't. The first occurrence in each window is still
// captured, so a sustained outage stays visible (deduplicated, not silenced).
const SERVER_ERROR_THROTTLE_MS = 60 * 1000;
const lastServerErrorCaptureAt = new Map<string, number>();
const captureServerErrorAllowed = (status: number, url: string): boolean => {
  const path = url.split("?")[0];
  const key = `${status}:${path}`;
  const now = Date.now();
  if (now - (lastServerErrorCaptureAt.get(key) ?? 0) < SERVER_ERROR_THROTTLE_MS)
    return false;
  lastServerErrorCaptureAt.set(key, now);
  return true;
};

// ── Session heartbeat: pings auth_service every 5 min to detect terminated sessions ──
const SESSION_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;
// Seed with the JS-context boot time, NOT 0, so cold-start does not immediately
// validate the session. iOS WKWebView kills the JS context on swipe-close;
// firing the heartbeat on the first request after relaunch hit a stale-session
// 460 from the backend and logged users out. Deferring by one interval gives
// the user 10 min of activity before we ask the backend if the session is
// still authoritative.
let lastHeartbeatTime = Date.now();

async function sessionHeartbeat(accessToken: string, instituteId: string) {
  const now = Date.now();
  if (now - lastHeartbeatTime < SESSION_HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeatTime = now;
  try {
    await axios.get(VALIDATE_SESSION, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        clientId: instituteId,
      },
    });
  } catch (error: any) {
    if (error?.response?.status === 460 && !isHandlingSessionTermination) {
      isHandlingSessionTermination = true;
      removeTokensAndLogout();
      window.location.assign("/session-terminated");
    }
    // Other errors (network, 401) are silently ignored — not the heartbeat's job
  }
}

const removeTokensAndInstituteId = async () => {
  const keysToRemove = [
    TokenKey.accessToken,
    TokenKey.refreshToken,
    "instituteId",
    "InstituteId",
  ];
  for (const key of keysToRemove) {
    await Preferences.remove({ key });
    // Also remove from localStorage — tokens are written there by setTokenInStorage
    // as a synchronous fallback, and getTokenFromStorage reads localStorage if
    // Preferences returns empty, which kept a stale token alive for 18+ days.
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      const Cookies = (await import("js-cookie")).default;
      Cookies.remove(key);
      Cookies.remove(key, { domain: ".vacademy.io" });
    } catch {
      /* ignore */
    }
  }
};

// True only when the refresh endpoint itself rejected the token (4xx).
// Network failures (status 0) and server errors (5xx) are transient — the
// session is still valid and must NOT be destroyed for them.
const isRefreshTokenRejected = (error: unknown): boolean => {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return typeof status === "number" && status >= 400 && status < 500;
};

const refreshTokens = async (refreshToken: string): Promise<void> => {
  try {
    const response = await axios.post(REFRESH_TOKEN_URL, { refreshToken });
    const {
      accessToken,
      refreshToken: newRefreshToken,
      instituteId,
    } = response.data;
    // Store the new tokens and institute ID
    await Preferences.set({ key: TokenKey.accessToken, value: accessToken });
    await Preferences.set({
      key: TokenKey.refreshToken,
      value: newRefreshToken,
    });
    if (instituteId) {
      await Preferences.set({ key: "instituteId", value: instituteId });
      await Preferences.set({ key: "InstituteId", value: instituteId });
    }
  } catch (error) {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    if (isRefreshTokenRejected(error)) {
      console.error("[Auth] Refresh token rejected by server:", error);
      captureAuthEvent("Forced logout: refresh token rejected", "warning", {
        refreshStatus: status,
      });
      toast.error("Session expired. Please log in again.");
      await removeTokensAndLogout();
    } else {
      // Flaky network / backend blip: keep tokens so the next request can retry
      console.error("[Auth] Token refresh failed transiently:", error);
      // The refresh call uses raw axios, so the instance's 5xx capture never
      // sees it. Only capture backend 5xx — a plain network drop (no status)
      // is everyday mobile reality, not an actionable error.
      if (typeof status === "number" && status >= 500) {
        captureAuthEvent("Token refresh failed with backend error", "error", {
          refreshStatus: status,
        });
      }
    }
    throw error;
  }
};

// Create an instance of Axios
const authenticatedAxiosInstance = axios.create({
  // Optional base configuration can be added here
  // For example: baseURL, timeout, etc.
  headers: {
    clientId: "",
    // Dev-only convenience: lets requests through ngrok's free-tier browser
    // interstitial when the offline APIs are tunnelled to a local backend.
    // Harmless for every other host (unknown headers are ignored).
    "ngrok-skip-browser-warning": "1",
  },
});

// Request interceptor: gets called before every request
authenticatedAxiosInstance.interceptors.request.use(
  async (request) => {
    const requestUrl = String(request.url || "");
    const isPublicDomainRouting = requestUrl.includes(
      "/public/domain-routing/",
    );
    const isOpenEndpoint = requestUrl.includes("/open/");

    // Advertise the user's UI locale so backend services can localize
    // responses (validation messages, notifications) as i18n rolls out.
    // Don't overwrite if the caller already set it explicitly.
    if (!request.headers["Accept-Language"]) {
      request.headers["Accept-Language"] = getActiveLocale();
    }

    // For public/open endpoints, do not attach auth or perform refresh logic
    if (isPublicDomainRouting || isOpenEndpoint) {
      try {
        // Attempt to attach local token if available, but do not force refresh/logout logic
        const accessToken = await getTokenFromStorage(TokenKey.accessToken);
        if (accessToken && !isTokenExpired(accessToken)) {
          request.headers["Authorization"] = `Bearer ${accessToken}`;
        }
      } catch {
        // no-op
      }
      request = maybeServeFromCache(request);
      return request;
    }

    const accessToken = await getTokenFromStorage(TokenKey.accessToken);
    let instituteId = await getTokenFromStorage("InstituteId");
    if (!instituteId) {
      instituteId = await getTokenFromStorage("instituteId");
    }
    // Attempt to populate user and package session for Vary-aware caching
    try {
      const studentDetailsStr = await Preferences.get({
        key: "StudentDetails",
      });
      if (studentDetailsStr?.value) {
        const student = JSON.parse(studentDetailsStr.value);
        const userId = student?.user_id || student?.userId;
        const packageSessionId =
          student?.package_session_id || student?.packageSessionId;
        if (userId) {
          request.headers["X-User-Id"] = String(userId);
        }
        if (packageSessionId) {
          request.headers["X-Package-Session-Id"] = String(packageSessionId);
        }
      }
    } catch {
      // no-op
    }

    // Add instituteId to headers if available
    if (instituteId) {
      request.headers["clientId"] = instituteId;
      request.headers["X-Institute-Id"] = instituteId;
    }

    // Check if the access token is expired
    const isExpired = isTokenExpired(accessToken);

    if (!isExpired) {
      request.headers.Authorization = `Bearer ${accessToken}`;
      // Piggyback session heartbeat (fires at most once every 10 min)
      if (instituteId) sessionHeartbeat(accessToken!, instituteId);
      // Serve from client cache for GET when possible
      request = maybeServeFromCache(request);
      return request;
    } else {
      // If the access token is expired, refresh it
      const refreshToken = await getTokenFromStorage(TokenKey.refreshToken);
      if (!refreshToken) {
        // An authenticated call with no refresh token means broken auth state
        // (or a component firing authenticated requests while logged out).
        captureAuthEvent(
          "Authenticated request without refresh token",
          "warning",
          { requestUrl },
        );
        await removeTokensAndInstituteId();
        return Promise.reject(new Error("Unauthorized"));
      }
      try {
        // Refresh tokens
        await refreshTokens(refreshToken);

        // Get the new access token after refresh
        const newAccessToken = await getTokenFromStorage(TokenKey.accessToken);
        request.headers["Authorization"] = `Bearer ${newAccessToken}`;
        // Serve from client cache for GET when possible
        request = maybeServeFromCache(request);
        return request;
      } catch (error) {
        if (isRefreshTokenRejected(error)) {
          // The session is genuinely over — clear auth state
          await removeTokensAndInstituteId();
          return Promise.reject(new Error("Unauthorized"));
        }
        // Transient refresh failure: fail this request but keep the session
        return Promise.reject(
          new Error("Token refresh failed, please retry"),
        );
      }
    }
  },
  async (error) => {
    return Promise.reject(error);
  },
);

// Response interceptor to handle global error responses
authenticatedAxiosInstance.interceptors.response.use(
  (response) => {
    // AI usage limits: a successful AI call near a soft limit carries
    // X-AI-Usage-Warning — a gentle, de-duplicated heads-up. Read-only.
    try {
      const warning = response?.headers?.["x-ai-usage-warning"];
      if (warning) notifyAiUsageWarning(warning);
    } catch {
      /* never let the warning affect the response */
    }
    // Store successful GET responses in client cache per headers
    return maybeStoreInCache(response);
  },
  async (error) => {
    // Allow public domain routing errors to pass through without auth side-effects
    const requestUrl = String(error?.config?.url || "");
    const isPublicDomainRouting = requestUrl.includes(
      "/public/domain-routing/",
    );

    const status = error?.response?.status;
    const responseData = error?.response?.data;

    // ── Sentry: capture server errors (5xx) and notable client errors ──
    //
    // Skip the capture when the backend returned 511 carrying a structured
    // VacademyException body (`ex` / `responseCode`). The shared
    // GlobalExceptionHandler in common_service maps *every* unmapped
    // RuntimeException to HTTP 511 with that body shape — so a structured
    // 511 is a business-logic error the caller already handles, not the
    // captive-portal auth failure 511 actually means. The matching admin
    // dashboard interceptor swallows these too; without this guard the
    // SCORM `/initialize` first-launch failure (and similar) fans out as
    // Sentry noise even though the UI is unaffected.
    const isStructured511 =
      status === 511 &&
      responseData &&
      typeof responseData === "object" &&
      ((responseData as { ex?: unknown }).ex ||
        (responseData as { responseCode?: unknown }).responseCode);

    // Skip 5xx capture on endpoints that are either separately instrumented or
    // polled in a loop. Auth/public/open endpoints have their own throttled
    // captureAuthEvent path; polling endpoints (session validation, system
    // alerts, dashboard pins, payment status) fire on a timer for every user,
    // so a single backend blip fans them out into thousands of identical events
    // — that burst is what trips Sentry's spike protection. The session-wide
    // 5xx is still captured from the user's non-polling requests.
    const isPollingOrSelfInstrumented =
      /\/open\/|\/public\/|refresh-token|validate-session|notification|dashboard|payment.*status|payment-status/i.test(
        requestUrl,
      );

    if (
      import.meta.env.VITE_ENABLE_SENTRY === "true" &&
      status &&
      status >= 500 &&
      !isStructured511 &&
      !isPollingOrSelfInstrumented &&
      captureServerErrorAllowed(status, requestUrl)
    ) {
      Sentry.withScope((scope) => {
        scope.setTag("http.status_code", String(status));
        scope.setTag(
          "http.method",
          error?.config?.method?.toUpperCase() || "UNKNOWN",
        );
        scope.setTag("api.url", requestUrl);
        scope.setLevel("error");
        scope.setContext("API Response", {
          status,
          statusText: error?.response?.statusText,
          url: requestUrl,
          method: error?.config?.method?.toUpperCase(),
          responseData:
            typeof error?.response?.data === "string"
              ? error.response.data.substring(0, 1000)
              : JSON.stringify(error?.response?.data)?.substring(0, 1000),
        });
        scope.setContext("API Request", {
          baseURL: error?.config?.baseURL,
          url: error?.config?.url,
          method: error?.config?.method,
          params: error?.config?.params,
        });
        Sentry.captureException(
          new Error(
            `API ${status}: ${error?.config?.method?.toUpperCase()} ${requestUrl}`,
          ),
        );
      });
    }

    // AI usage limit (429 with error "AI_USAGE_LIMIT"): a friendly toast,
    // unless the screen shows it inline (claimAiUsageLimit). Other 429s are
    // untouched, and the error is always re-thrown to the caller as before.
    if (status === 429) {
      try {
        const limit = getAiUsageLimitFromError(error);
        if (limit) scheduleAiUsageLimitToast(error, limit);
      } catch {
        /* fall through: the caller still gets the original error */
      }
    }

    // Handle session-terminated (460) — distinct from normal 401
    if (
      !isPublicDomainRouting &&
      error.response &&
      status === 460 &&
      !isHandlingSessionTermination
    ) {
      isHandlingSessionTermination = true;
      removeTokensAndLogout();
      window.location.assign("/session-terminated");
      return Promise.reject(error);
    }

    // Handle unauthorized errors (401)
    if (!isPublicDomainRouting && error.response && status === 401) {
      console.warn(
        "[Axios] Received 401 Unauthorized. Not performing auto-logout to avoid session recovery race conditions. Route guards will handle redirection if needed.",
      );
    }

    // Handle forbidden errors (403) - might be token issues
    if (!isPublicDomainRouting && error.response && status === 403) {
      // Handle 403 errors silently
    }

    return Promise.reject(error);
  },
);

export const guestAxiosInstance = axios.create();

guestAxiosInstance.interceptors.request.use(async (request) => {
  try {
    let instituteId = await getTokenFromStorage("InstituteId");
    if (!instituteId) {
      instituteId = await getTokenFromStorage("instituteId");
    }
    if (instituteId) {
      request.headers["clientId"] = instituteId;
      request.headers["X-Institute-Id"] = instituteId;
    }
  } catch (err) {
    console.error("[GuestAxios] Error attaching institute ID:", err);
  }
  return request;
});

export default authenticatedAxiosInstance;
