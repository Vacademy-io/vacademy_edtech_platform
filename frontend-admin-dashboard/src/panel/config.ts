/**
 * Vacademy Classroom (panel bundle) constants.
 *
 * PANEL_MIN_CHROME must equal `var MIN = 66` in panel.html and `minWebViewMajor`
 * in android/app/mobile-flavors.json — scripts/panel/verify-panel-dist.mjs fails
 * the build when the three disagree.
 */
export const PANEL_MIN_CHROME = 66;

/**
 * Sign the teacher out after this long with no pointer/key activity (3 h). The
 * last-activity time is persisted (PANEL_STORAGE_KEYS.lastActivityAt) so the clock
 * also covers reboots / app restarts (enforceIdleSignOutAtBoot).
 */
export const PANEL_IDLE_SIGNOUT_MS = 3 * 60 * 60 * 1000;

/** The persisted last-activity time is rewritten at most this often. */
export const PANEL_ACTIVITY_WRITE_MS = 60 * 1000;

/**
 * A stored live Volt session suspends idle sign-out only while it is younger than
 * this (4 h, above the backend's 3 h presenter emitter): a leftover record must not
 * keep a forgotten session signed in for the cookie's whole 7-day life.
 */
export const PANEL_LIVE_SESSION_EXEMPT_MS = 4 * 60 * 60 * 1000;

/** Refresh the access JWT when it expires within this window (24 h). */
export const REFRESH_SKEW_MS = 24 * 60 * 60 * 1000;

/** Branding refresh gives up after this long; failures are ignored. */
export const BRANDING_TIMEOUT_MS = 3000;

/**
 * localStorage keys owned by the panel. Everything prefixed `panel.` survives
 * sign-out (clearPanelSession removes only the two auth cookies).
 */
export const PANEL_STORAGE_KEYS = {
    deviceId: 'panel.deviceId',
    firstRunDone: 'panel.firstRunDone',
    branding: 'panel.branding',
    whiteboardScene: 'panel.whiteboard.scene',
    voltActiveSession: 'panel.volt.activeSession',
    lastActivityAt: 'panel.lastActivityAt',
} as const;

/** Shared with the admin app (same names, same meaning). */
export const SHARED_STORAGE_KEYS = {
    selectedInstituteId: 'selectedInstituteId',
    themeCode: 'theme-code',
    locale: 'vacademy-locale',
} as const;

export const ENGAGE_DOMAIN: string =
    (import.meta.env.VITE_ENGAGE_DOMAIN as string | undefined) || 'engage.vacademy.io';

/** The admin app's default brand colour (ThemeProvider falls back to it too). */
export const DEFAULT_THEME_CODE = '#ED7424'; // design-lint-ignore: theme code value passed to ThemeProvider, not a style

/** Roles allowed on the panel: anyone with at least one non-STUDENT role. */
export const PANEL_BLOCKED_ROLE = 'STUDENT';
