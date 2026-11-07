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

/** Phase 0 login only: refresh the access JWT when it expires within this window (24 h). */
export const REFRESH_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Lab builds only (VITE_PANEL_LEGACY_LOGIN=1): an unpaired panel runs the Phase 0
 * username and password login. Replaced at build time by vite.panel.config.ts, so
 * in a release build the whole path is dropped from the bundle.
 */
export const PANEL_LEGACY_LOGIN: boolean = import.meta.env.VITE_PANEL_LEGACY_LOGIN === '1';

/** Paired mode: refresh the short access JWT when it has less than this left. */
export const PANEL_REFRESH_SKEW_MS = 5 * 60 * 1000;
/** A failed refresh is not retried by ordinary requests for this long. */
export const PANEL_REFRESH_BACKOFF_MS = 15 * 1000;
/** What is kept after DEVICE_REVOKED, and how often it is rechecked. */
export const DEVICE_REVOKED_KEEP_MS = 24 * 60 * 60 * 1000;
export const DEVICE_REVOKED_RECHECK_MS = 5 * 60 * 1000;
/** Sign-in QR stays up for this long after boot, input or sign-out. */
export const SIGN_IN_WINDOW_MS = 10 * 60 * 1000;
/** A challenge is replaced this long before it expires, never while scanned. */
export const CHALLENGE_RENEW_BEFORE_MS = 30 * 1000;
/** Pair code stays up for this long after boot or input. */
export const PAIR_WINDOW_MS = 60 * 60 * 1000;
/** Retry interval once a screen has gone to its offline state. */
export const OFFLINE_RETRY_MS = 15 * 1000;
/** Retry after the first failure, before a screen admits to being offline. */
export const FIRST_RETRY_MS = 3 * 1000;
/** The "Still teaching?" bar. */
export const SESSION_COUNTDOWN_MS = 60 * 1000;
/** Warn this long before the server's session cap. */
export const SESSION_WARN_BEFORE_MS = 15 * 60 * 1000;
/** End-of-class bar: this long after the class ended, with no input for END_OF_CLASS_QUIET_MS. */
export const END_OF_CLASS_GRACE_MS = 10 * 60 * 1000;
export const END_OF_CLASS_QUIET_MS = 5 * 60 * 1000;

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
    /** Paired device credentials and the last known room and institute. */
    device: 'panel.device',
    /** Set while pairing: the pair secret, then the claim waiting for confirmation. */
    pairing: 'panel.pairing',
    sessionMeta: 'panel.sessionMeta',
    /** A /session/end that could not be delivered; the sync loop retries it. */
    pendingEnd: 'panel.pendingEnd',
    resume: 'panel.resume',
    /** LRU index of the offline caches: which entries exist, their size and last use. */
    offlineIndex: 'panel.offline.index',
    /** Set while the offline caches are being wiped, so a restart finishes the job. */
    offlineWipe: 'panel.offline.wipe',
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
