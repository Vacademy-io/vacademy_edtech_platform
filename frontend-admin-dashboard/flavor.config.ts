/**
 * Capacitor flavor definitions for the admin dashboard.
 *
 * The same web bundle ships as more than one native app. A flavor selects the
 * native identity (appId / appName), the OTA channel, and a handful of runtime
 * behaviours (which shell to land on, which institute to anchor branding to).
 *
 * This module is imported from TWO different runtimes, so it must stay free of
 * any browser- or Capacitor-specific imports:
 *   - `capacitor.config.ts` (Node / ts-node at `cap sync` time) reads it to
 *     stamp the native project (appId, appName, OTA plugin config).
 *   - `src/native/flavor.ts` (the browser bundle) reads it at runtime to gate
 *     behaviour, keyed off the build-time `VITE_CAP_FLAVOR` value.
 *
 * Selection is done at BUILD time via the `VITE_CAP_FLAVOR` env var so the
 * value is available synchronously on first paint (no async `App.getInfo()`
 * round-trip before the router mounts). Each native binary is built + synced
 * with its own `VITE_CAP_FLAVOR`, so the baked value always matches the
 * installed `appId`.
 */

export type OtaMode =
    | 'self-hosted' // Our own admin-core OTA backend (learner-app style, autoUpdate off)
    | 'capgo' // Capgo cloud OTA (autoUpdate on)
    | 'none'; // Web / no OTA

export interface AdminFlavor {
    /** Flavor key — the kebab-case slug; also the GoogleServiceConfigs/<key>/ folder + mobile-flavors.json key. */
    key: string;
    /** Native bundle identifier (must match Android applicationId / iOS PRODUCT_BUNDLE_IDENTIFIER). */
    appId: string;
    /** Native display name (home-screen label). */
    appName: string;
    /**
     * When true the native cold-start is forced into the `/vim` shell. Vimotion
     * is product-scoped to the video studio; Vacademy Admin is the full portal.
     */
    forceVimShell: boolean;
    /**
     * When true the app is the Evalezy copy-check app: cold start, the root path and
     * every portal route are kept inside the simple `/evalezy` shell (pick an
     * assessment → scan/upload copies → AI check → download the checked zip).
     * Same bundle, same login and APIs as the full portal; see src/lib/evalezy-mode.ts.
     */
    forceEvalezyShell?: boolean;
    /**
     * Host whose https links open this app (Android App Links / iOS Universal
     * Links). Mirrors `deepLinkHost` in android/app/mobile-flavors.json; the JS
     * deep-link handler maps `https://<host>/<path>` to the in-app route `<path>`.
     */
    deepLinkHost?: string;
    /**
     * Fixed branding/theme source. A native WebView has no meaningful hostname,
     * so instead of host-based domain routing the app resolves branding via this
     * fixed (domain, subdomain) against the EXISTING public domain-routing
     * endpoint — i.e. the `institute_domain_routing` row that maps to this app's
     * institute (theme, title, logo, auth toggles, role). This is BRANDING ONLY:
     * login still resolves the signed-in user's own institute, so any institute's
     * admin can sign in while the app keeps this flavor's look.
     */
    brandingDomain?: string;
    brandingSubdomain?: string;
    /** Anchor institute id (reference; OTA/branding row maps to it). */
    instituteId?: string;
    /** OTA delivery mechanism for this flavor. */
    ota: OtaMode;
    /**
     * Capacitor `webDir` this flavor syncs into the native project. Defaults to
     * `'dist'` (the main admin build) when omitted. The classroom panel app ships
     * its own slim bundle from `dist-panel/`.
     */
    webDir?: string;
    /**
     * Whether the PrivacyScreen plugin is enabled (Android FLAG_SECURE + iOS
     * app-switcher blur). Defaults to `true` when omitted. Classroom panels turn
     * it off: FLAG_SECURE blocks screenshots, casting and OEM annotate overlays.
     */
    privacyScreen?: boolean;
    /**
     * Classroom interactive-panel / Android TV mode. Defaults to `false`. When
     * true the native config appends `VacademyClassroom` to the WebView UA; the
     * Android side keys its panel behaviour (WebView gate, immersive, keep-screen-on,
     * PanelDevice plugin) off the per-flavor `panel_mode` resValue generated from
     * android/app/mobile-flavors.json, not off this field.
     */
    panelMode?: boolean;
}

export const ADMIN_FLAVORS = {
    'vacademy-admin': {
        key: 'vacademy-admin',
        appId: 'io.vacademy.admin.app',
        appName: 'Vacademy Admin',
        forceVimShell: false,
        // institute_domain_routing row "VACADEMY-ADMIN-APP" → institute ca3c…,
        // role ADMIN, tab_text "Vacademy Platform". Drives the app's theme/title.
        brandingDomain: 'vacademy.io',
        brandingSubdomain: 'admin-app',
        instituteId: 'ca3c4734-7913-48a8-b116-f8f7e0c60eba',
        deepLinkHost: 'dash.vacademy.io',
        ota: 'self-hosted',
    },
    // Evalezy: the AI copy-check app. Same portal and login (any institute's admin
    // can sign in); the bundle is held inside the /evalezy shell. Deliberately NO
    // brandingDomain: no institute owns Evalezy, so like the web host
    // evalezy.vacademy.io it resolves no domain-routing row and wears the Evalezy
    // brand (index.tsx), and login never gets pinned to one institute.
    evalezy: {
        key: 'evalezy',
        appId: 'io.evalezy.app',
        appName: 'Evalezy',
        forceVimShell: false,
        forceEvalezyShell: true,
        deepLinkHost: 'evalezy.vacademy.io',
        ota: 'self-hosted',
    },
    vimotion: {
        key: 'vimotion',
        appId: 'io.vimotion.app',
        appName: 'Vimotion',
        forceVimShell: true,
        ota: 'capgo',
    },
    // Teacher app for classroom interactive flat panels (Android 9-11, frozen
    // system WebView) and Android TV. Ships the slim panel bundle (dist-panel/,
    // built by scripts/panel/build-panel.mjs), not the admin portal. No
    // brandingDomain: the panel bundle does its own branding.
    // TODO(classroom OTA): ota 'none' until strict-target OTA ids exist for
    // io.vacademy.classroom (publish-ota.sh only knows the admin app).
    'vacademy-classroom': {
        key: 'vacademy-classroom',
        appId: 'io.vacademy.classroom',
        appName: 'Vacademy Classroom',
        forceVimShell: false,
        ota: 'none',
        webDir: 'dist-panel',
        privacyScreen: false,
        panelMode: true,
    },
    // Add a white-label admin app for another institute by appending an entry
    // here (key = kebab-case slug). The type below + isAdminFlavorKey pick it up
    // automatically — no other edits. Mirror the key in android/app/mobile-flavors.json
    // and add GoogleServiceConfigs/<key>/ on both platforms. See
    // ADDING_A_WHITE_LABEL_ADMIN_APP.md.
} satisfies Record<string, AdminFlavor>;

/** All registered admin flavor keys — auto-derived from `ADMIN_FLAVORS`. */
export type AdminFlavorKey = keyof typeof ADMIN_FLAVORS;

/**
 * Default flavor when `VITE_CAP_FLAVOR` is unset.
 *
 * This repo's native iOS/Android projects ARE the Vacademy Admin app (the iOS
 * target bundle id is hardcoded to io.vacademy.admin.app), so the default must
 * resolve to `vacademy-admin`. A flavorless `cap sync` / `build` was otherwise
 * regenerating the native config as Vimotion (autoUpdate:true + Capgo URLs and
 * launchAutoHide:false), which white-screens / hangs the admin app on the splash.
 *
 * Vimotion builds must set `VITE_CAP_FLAVOR=vimotion` explicitly (the
 * `build:vimotion` / `cap:*:vimotion` scripts do this).
 */
export const DEFAULT_FLAVOR_KEY: AdminFlavorKey = 'vacademy-admin';

export function isAdminFlavorKey(value: string | undefined | null): value is AdminFlavorKey {
    return value != null && Object.prototype.hasOwnProperty.call(ADMIN_FLAVORS, value);
}

/** Resolve a flavor by key, falling back to the default. */
export function getFlavorByKey(key: string | undefined | null): AdminFlavor {
    return ADMIN_FLAVORS[isAdminFlavorKey(key) ? key : DEFAULT_FLAVOR_KEY];
}
