// Single sign-on through an institute's own identity provider (Entra ID, Okta,
// Google Workspace...). The backend runs the OIDC flow; the portal only:
//   1. asks whether this institute has SSO on (discover),
//   2. sends the browser to /sso/start with its own origin and the path to come back to,
//   3. swaps the one-time ?sso_code= it comes back with for tokens (see __root beforeLoad).
// Tokens never appear in a URL. Each sign-in is tied to the tab that started it: the tab
// keeps a random value, /start gets only its hash, and /exchange must show the value.

import { BASE_URL } from "@/constants/urls";

export const SSO_DISCOVER_URL = `${BASE_URL}/auth-service/open/v1/sso/discover`;
export const SSO_START_URL = `${BASE_URL}/auth-service/open/v1/sso/start`;
export const SSO_EXCHANGE_URL = `${BASE_URL}/auth-service/open/v1/sso/exchange`;

export type SsoDiscovery = {
  enabled: boolean;
  connectionId?: string;
  displayName?: string;
  autoRedirect?: boolean;
};

/** Error codes the backend sends back as ?sso_error=. Anything else reads as "generic". */
export const SSO_ERROR_CODES = [
  "access_denied",
  "account_conflict",
  "account_disabled",
  "email_domain_not_allowed",
  "email_not_verified",
  "expired",
  "missing_email",
  "not_assigned",
  "not_configured",
  "session_limit",
] as const;
export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number] | "generic";

const DISCOVERY_CACHE_PREFIX = "enterpriseSso:";
const DISCOVERY_CACHE_MS = 5 * 60 * 1000;

/** Whether the institute signs learners in through its own provider. Never throws. */
export async function discoverSso(instituteId: string): Promise<SsoDiscovery> {
  const cacheKey = DISCOVERY_CACHE_PREFIX + instituteId;
  try {
    const raw = window.sessionStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; value: SsoDiscovery };
      if (Date.now() - cached.at < DISCOVERY_CACHE_MS) return cached.value;
    }
  } catch {
    // No storage: ask the server.
  }
  try {
    const response = await fetch(
      `${SSO_DISCOVER_URL}?institute_id=${encodeURIComponent(instituteId)}`,
      { credentials: "omit" },
    );
    if (!response.ok) return { enabled: false };
    const body = (await response.json()) as {
      enabled?: boolean;
      connection_id?: string;
      display_name?: string;
      auto_redirect?: boolean;
    };
    const value: SsoDiscovery = {
      enabled: body.enabled === true,
      connectionId: body.connection_id,
      displayName: body.display_name,
      autoRedirect: body.auto_redirect === true,
    };
    try {
      window.sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), value }));
    } catch {
      // Not cached; fine.
    }
    return value;
  } catch {
    return { enabled: false };
  }
}

/** A same-site path to come back to, or "/". */
export function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return "/";
  }
  return path;
}

const VERIFIER_KEY = "enterpriseSso:verifier";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The value this tab must show at /exchange, or null. */
export function readSsoVerifier(): string | null {
  try {
    return window.sessionStorage.getItem(VERIFIER_KEY);
  } catch {
    return null;
  }
}

export function clearSsoVerifier(): void {
  try {
    window.sessionStorage.removeItem(VERIFIER_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Sends the browser to the institute's provider, tied to this tab. */
export async function startSso(instituteId: string, returnPath?: string | null): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  try {
    window.sessionStorage.setItem(VERIFIER_KEY, verifier);
  } catch {
    // Without storage the exchange cannot prove this tab; the backend will refuse it.
  }
  const params = new URLSearchParams({
    institute_id: instituteId,
    portal_origin: window.location.origin,
    return_path: safeReturnPath(returnPath),
    client_binding: base64Url(new Uint8Array(digest)),
  });
  window.location.assign(`${SSO_START_URL}?${params.toString()}`);
}

/** The ?sso_error= the backend sent the learner back with, if any. */
export function readSsoError(search: string = window.location.search): SsoErrorCode | null {
  const code = new URLSearchParams(search).get("sso_error");
  if (!code) return null;
  return (SSO_ERROR_CODES as readonly string[]).includes(code)
    ? (code as SsoErrorCode)
    : "generic";
}

/**
 * Set when the learner chose "use another way to sign in", so auto-redirect does not
 * send them straight back to the provider for the rest of this tab.
 */
const SKIP_AUTO_KEY = "enterpriseSso:skipAuto";
export function skipAutoRedirect(): void {
  try {
    window.sessionStorage.setItem(SKIP_AUTO_KEY, "1");
  } catch {
    // Without storage the choice lasts until reload; acceptable.
  }
}
export function autoRedirectSkipped(): boolean {
  try {
    return window.sessionStorage.getItem(SKIP_AUTO_KEY) === "1";
  } catch {
    return false;
  }
}
