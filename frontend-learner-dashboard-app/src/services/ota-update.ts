import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { App } from "@/utils/app-plugin";
import { Capacitor } from "@capacitor/core";
import { BACKEND_BASE_URL } from "@/config/baseUrl";

const OTA_CHECK_URL = `${BACKEND_BASE_URL}/admin-core-service/public/ota/v1/check`;

// App ids that OPT OUT of OTA entirely — they are distributed only via the app
// store and must never ride the shared learner OTA stream (whose fleet-wide
// "all apps" bundles would otherwise surface as an update banner). Sadbhavana
// is a newly-registered App Store app the user releases manually, not via OTA.
const OTA_DISABLED_APP_IDS = new Set<string>([
  "io.sadbhavana.com",
]);

// How a native app surfaces an available OTA bundle. Two live modes:
//   "auto"   — show a non-dismissible "Updating app…" loader dialog on launch,
//              then download + apply the bundle in place (set → WebView reload).
//              Runs at launch ONLY, so it can never reload mid-session and wipe
//              a learner's in-progress exam attempt.
//   "banner" — surface a dismissible "Update X available" banner (or a blocking
//              "Update Required" overlay for force updates) and let the user tap
//              to apply.
// Apps that must not OTA at all are handled earlier via OTA_DISABLED_APP_IDS.
//
// NOTE (bootstrap): the mode ships IN the bundle, so the FIRST OTA a device
// receives is still handled by whatever JS it currently runs; every update
// AFTER that uses the mode below.
export type OtaUpdateMode = "auto" | "banner";

// Fleet-wide default. Every native app uses this unless its app id is listed in
// BANNER_OTA_APP_IDS below. Flip this one constant to change the default mode
// for all apps.
const DEFAULT_OTA_MODE: OtaUpdateMode = "auto";

// Per-app overrides: app ids listed here use the dismissible banner instead of
// the auto-updating dialog. (Add an app's id here to opt it out of auto-update.)
const BANNER_OTA_APP_IDS = new Set<string>([
  // e.g. "com.example.app",
]);

/**
 * Resolve the OTA update mode for the currently running app. Returns the fleet
 * default (DEFAULT_OTA_MODE) unless this app id is explicitly listed as a
 * banner app in BANNER_OTA_APP_IDS.
 */
export async function getOtaUpdateMode(): Promise<OtaUpdateMode> {
  const appInfo = await App.getInfo();
  return BANNER_OTA_APP_IDS.has(appInfo.id) ? "banner" : DEFAULT_OTA_MODE;
}

export interface OtaCheckResponse {
  update_available: boolean;
  version?: string;
  bundle_download_url?: string;
  checksum?: string;
  bundle_size_bytes?: number;
  force_update?: boolean;
  release_notes?: string;
}

/**
 * Numeric dotted-version compare. Anything that is not a dotted number at all
 * (the plugin's "builtin" sentinel, an empty string) counts as older, so the
 * caller's floor wins.
 */
function isVersionOlderThan(a: string, b: string): boolean {
  const parse = (v: string): number[] | null => {
    const parts = String(v ?? "").trim().split(".");
    if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
    return parts.map(Number);
  };
  const left = parse(a);
  const right = parse(b);
  if (!right) return false; // no usable floor — leave the reported value alone
  if (!left) return true; // unparseable ("builtin") — treat as older
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r;
  }
  return false;
}

/**
 * Check our backend for a new OTA bundle version.
 * Only runs on Android/iOS — returns no-update on web/electron.
 */
export async function checkForOtaUpdate(): Promise<OtaCheckResponse> {
  // Local-dev escape hatch: a bundle built with VITE_DISABLE_OTA=true never
  // self-updates. Without this, the OTA check replaces a locally-built debug
  // bundle with the production one ~20s after every launch, silently undoing
  // whatever is being tested on-device. Never set in production builds.
  if (import.meta.env.VITE_DISABLE_OTA === "true") {
    return { update_available: false };
  }

  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") {
    return { update_available: false };
  }

  const appInfo = await App.getInfo();

  // Opt-out apps (e.g. Sadbhavana) never show the OTA banner.
  if (OTA_DISABLED_APP_IDS.has(appInfo.id)) {
    return { update_available: false };
  }

  const current = await CapacitorUpdater.current();

  // If the plugin has an active OTA bundle, use its version. Otherwise (first
  // run / no OTA applied yet) fall back to the EMBEDDED JS bundle version
  // (__APP_VERSION__, injected from package.json) — NOT the native app version.
  // The native version (e.g. iOS MARKETING_VERSION 1.0.x) lives in a different
  // numbering space than OTA bundles (2.2.x); using it made every published
  // bundle look newer and surfaced a false "update available" banner that, if
  // tapped, would downgrade the embedded JS.
  // The "builtin" literal is not the only value the plugin reports for a fresh
  // install: it also hands back the NATIVE app version (iOS MARKETING_VERSION,
  // e.g. 1.0.1) for a device that has never applied an OTA. That number lives in
  // a different numbering space than OTA bundles (2.x), so it reads as ancient
  // and the backend answers with the newest UNTARGETED bundle — one cut before
  // this brand existed, whose flavor.config has no entry for its app id. The app
  // then resolves its domain from window.location.hostname ("localhost" in a
  // WebView), that resolve 404s, and the login screen falls back to the stored
  // institute id with no logo, no name and no theme.
  //
  // So never report a version BELOW the embedded bundle: whatever the plugin
  // says, __APP_VERSION__ is the floor. An OTA bundle older than the JS compiled
  // into this binary is never something we want to download.
  const reportedVersion =
    current.bundle.version === "builtin"
      ? __APP_VERSION__
      : current.bundle.version;
  const currentBundleVersion = isVersionOlderThan(
    reportedVersion,
    __APP_VERSION__,
  )
    ? __APP_VERSION__
    : reportedVersion;

  const params = new URLSearchParams({
    platform: platform.toUpperCase(),
    currentBundleVersion,
    nativeVersion: appInfo.version,
    appId: appInfo.id,
  });

  const response = await fetch(`${OTA_CHECK_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`OTA check failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Download a bundle zip and stage it for the next app restart.
 */
export async function downloadAndApplyUpdate(
  bundleDownloadUrl: string,
  version: string,
  checksum: string,
): Promise<void> {
  const bundle = await CapacitorUpdater.download({
    url: bundleDownloadUrl,
    version,
    checksum,
  });

  // set() applies the bundle and reloads the WebView immediately
  await CapacitorUpdater.set(bundle);
}

/**
 * Download a bundle zip and STAGE it for the next app restart/resume via next().
 * Unlike downloadAndApplyUpdate (set = immediate reload), this never reloads the
 * WebView mid-session — the staged bundle activates silently the next time the
 * app is backgrounded/relaunched. No UI is shown. Used by the silent OTA path.
 */
export async function downloadAndStageUpdate(
  bundleDownloadUrl: string,
  version: string,
  checksum: string,
): Promise<void> {
  const bundle = await CapacitorUpdater.download({
    url: bundleDownloadUrl,
    version,
    checksum,
  });

  // next() activates the bundle on the next app background/relaunch — no reload now.
  await CapacitorUpdater.next({ id: bundle.id });
}

/**
 * MUST be called on every app start after the bundle loads successfully.
 * If not called within 10 seconds, the plugin auto-rolls back to the
 * previous working bundle (crash protection).
 */
export async function notifyUpdateSuccess(): Promise<void> {
  await CapacitorUpdater.notifyAppReady();
}
