import { Capacitor, registerPlugin } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { getPlatformFlavorInfo } from "@/utils/platform-flavor";
import { NATIVE_OAUTH_CALLBACK_PARAM } from "@/lib/auth/native-oauth-handoff";

let _cachedOrigin: string | null = null;

/**
 * Returns the public-facing origin URL for OAuth redirects.
 * - Web: window.location.origin (e.g. https://ssdc.vacademy.io)
 * - Native (Android/iOS): derived from flavor config (e.g. https://ssdc.vacademy.io)
 * - Electron: falls back to VITE_LEARNER_DASHBOARD_URL
 *
 * On native platforms window.location.origin resolves to capacitor://localhost
 * or http://localhost which the OAuth provider / backend cannot redirect back to.
 */
export async function getOAuthRedirectOrigin(): Promise<string> {
  if (_cachedOrigin) return _cachedOrigin;

  const platform = Capacitor.getPlatform();

  if (platform === "web") {
    _cachedOrigin = window.location.origin;
    return _cachedOrigin;
  }

  // Native (android / ios) or electron — derive from flavor config
  try {
    const platformInfo = await getPlatformFlavorInfo();
    if (platformInfo.flavorConfig) {
      const { domain, subdomain } = platformInfo.flavorConfig;
      _cachedOrigin = `https://${subdomain}.${domain}`;
      return _cachedOrigin;
    }
  } catch (e) {
    console.warn("[nativeOAuth] Failed to get flavor info, using fallback", e);
  }

  // Fallback
  _cachedOrigin =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import.meta.env as any).VITE_LEARNER_DASHBOARD_URL ||
    "https://learner.vacademy.io";
  return _cachedOrigin;
}

/**
 * Whether the current platform requires the native OAuth flow
 * (system browser + deep-link callback instead of popup).
 */
export function isNativeOAuthRequired(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios";
}

interface NativeAuthSessionPlugin {
  start(options: { url: string; callbackScheme: string }): Promise<{ url?: string; cancelled?: boolean }>;
}

// iOS only, registered by MainViewController. App binaries older than the
// plugin still receive this JS over the air, so a missing plugin must fall
// back to the Browser flow rather than fail.
const NativeAuthSession = registerPlugin<NativeAuthSessionPlugin>("NativeAuthSession");

/** Rewrites the OAuth `state` so its return URL asks for a hand-off to `scheme`. */
export function withNativeOAuthCallback(url: string, scheme: string): string {
  const u = new URL(url);
  const raw = u.searchParams.get("state");
  if (!raw) return url;
  const state = JSON.parse(atob(raw)) as { from?: unknown };
  if (typeof state.from !== "string") return url;
  const from = new URL(state.from);
  from.searchParams.set(NATIVE_OAUTH_CALLBACK_PARAM, scheme);
  state.from = from.toString();
  u.searchParams.set("state", btoa(JSON.stringify(state)));
  return u.toString();
}

/**
 * Opens the OAuth URL outside the WebView (window.open popups don't work there).
 *
 * iOS: `ASWebAuthenticationSession` with the app id as callback scheme. The final
 * redirect to the learner host cannot reach the app (no Universal Links for the
 * white-label apps), so the host hands it to `<app id>://` instead; the session
 * catches it and the app's `appUrlOpen` handler finishes the sign-in.
 * Android / older iOS binaries: Capacitor Browser + App Links, as before.
 */
export async function openOAuthInSystemBrowser(url: string): Promise<void> {
  if (Capacitor.getPlatform() === "ios") {
    const { appId } = await getPlatformFlavorInfo();
    if (appId) {
      try {
        await NativeAuthSession.start({
          url: withNativeOAuthCallback(url, appId),
          callbackScheme: appId,
        });
        return;
      } catch (err) {
        if ((err as { code?: string })?.code !== "UNIMPLEMENTED") throw err;
      }
    }
  }
  await Browser.open({ url, presentationStyle: "popover" });
}

/**
 * Closes the in-app browser opened by the Capacitor Browser plugin.
 */
export async function closeSystemBrowser(): Promise<void> {
  try {
    await Browser.close();
  } catch {
    // Browser.close() may throw if the browser is already closed
  }
}
