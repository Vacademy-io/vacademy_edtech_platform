import type { CapacitorConfig } from '@capacitor/cli';
import { getFlavorByKey } from './flavor.config';

// Multi-flavor native config. The same web build ships as more than one app:
//   - vacademy-admin (io.vacademy.admin.app, "Vacademy Admin") — the full admin
//     portal, self-hosted OTA (our admin-core OTA backend, learner-app style).
//   - vimotion (io.vimotion.app, "Vimotion") — the /vim video-studio shell,
//     Capgo cloud OTA.
//
// Selected at build/sync time via VITE_CAP_FLAVOR (defaults to `vimotion` so an
// env-less `cap sync` keeps producing the pre-existing Vimotion app). The npm
// scripts (cap:*:vacademy-admin / cap:*:vimotion) set it for you.
const flavor = getFlavorByKey(process.env.VITE_CAP_FLAVOR);

// OTA plugin config differs by flavor. Both use @capgo/capacitor-updater, but:
//   - self-hosted: autoUpdate OFF — we check our own backend and call
//     CapacitorUpdater.download/set/notifyAppReady from src/services/ota-update.ts.
//   - capgo: autoUpdate ON against the Capgo cloud endpoints.
const otaPluginConfig =
    flavor.ota === 'capgo'
        ? {
              autoUpdate: true,
              updateUrl: 'https://api.capgo.app/updates',
              statsUrl: 'https://api.capgo.app/stats',
              channelUrl: 'https://api.capgo.app/channel_self',
              directUpdate: true,
          }
        : {
              // Self-hosted OTA: we drive the update lifecycle ourselves.
              autoUpdate: false,
          };

const config: CapacitorConfig = {
    appId: flavor.appId,
    appName: flavor.appName,
    // Per-flavor web bundle: the admin portal ships dist/, the classroom panel
    // app ships its slim dist-panel/ bundle. Unset → 'dist' (admin/vimotion).
    webDir: flavor.webDir ?? 'dist',
    server: {
        // Serve the WebView from https://localhost on BOTH platforms. iOS defaults
        // to the custom capacitor:// scheme, where js-cookie/document.cookie writes
        // are not reliably read back — which broke login (the role check reads the
        // auth token from a cookie right after setting it and saw it empty →
        // "Students are not allowed"). Matching Android's https scheme fixes it.
        iosScheme: 'https',
        androidScheme: 'https',
        // Live reload against the local Vite dev server: set CAP_DEV_SERVER=<url>.
        ...(process.env.CAP_DEV_SERVER ? { url: process.env.CAP_DEV_SERVER, cleartext: true } : {}),
    },
    ios: {
        // Keeps the WKWebView from being pushed underneath the status bar before
        // the in-app status bar plugin loads (avoids first-paint flash on cold
        // start). Status bar colour/style are set at runtime by statusBar.ts.
        contentInset: 'always',
        // Vimotion drove its own scrolling, so it disabled the WKWebView scroll
        // view. The full admin portal relies on normal page scrolling, so it MUST
        // keep the scroll view enabled — otherwise pages don't scroll on iOS.
        scrollEnabled: flavor.key === 'vimotion' ? false : true,
    },
    android: {
        allowMixedContent: false,
        // Classroom panel app: tag the WebView UA (" VacademyClassroom") so the
        // panel bundle can show it in Diagnostics. JS never gates on it.
        // minWebViewVersion stays at Capacitor's default: MainActivity's own
        // panel gate (R.bool.panel_mode) runs before the bridge loads.
        ...(flavor.panelMode ? { appendUserAgent: 'VacademyClassroom' } : {}),
    },
    plugins: {
        // Patch document.cookie to the native cookie store. Required for iOS:
        // WKWebView does not reliably read back a js-cookie/document.cookie write
        // within the same flow, so the login role-check read the auth token cookie
        // as empty → "Students are not allowed". With this enabled, cookies work
        // consistently on both platforms (Android already worked).
        CapacitorCookies: {
            enabled: true,
        },
        SplashScreen: {
            launchShowDuration: flavor.key === 'vimotion' ? 1500 : 2000,
            // Vimotion's /vim shell calls SplashScreen.hide() manually after first
            // paint. Full-portal flavors (e.g. Vacademy Admin) have no such shell,
            // so auto-hide MUST be on or the splash sticks forever.
            launchAutoHide: flavor.key !== 'vimotion',
            backgroundColor: '#FAFAF7',
            androidScaleType: 'CENTER_CROP',
            showSpinner: false,
            splashFullScreen: true,
            splashImmersive: true,
            useDialog: false,
        },
        StatusBar: {
            backgroundColor: '#FFFFFF',
            style: 'LIGHT',
            overlaysWebView: false,
        },
        // NOTE: @capacitor/keyboard is intentionally NOT used — its Android IME
        // inset-animation handling cancelled the soft-keyboard show on Android 16
        // (tap focused the field but no keyboard appeared). The WebView's native
        // keyboard handling is used instead; safe-area is handled in CSS via
        // env(safe-area-inset-*). See src/native/keyboard.ts.
        FirebaseMessaging: {
            presentationOptions: ['badge', 'sound', 'alert'],
        },
        PrivacyScreen: {
            // Blur app contents in iOS app switcher + Android recent apps so
            // institute data never appears in the OS task screenshot.
            // Classroom panels opt out (privacyScreen:false): FLAG_SECURE would
            // block screenshots, casting/mirroring and OEM annotate overlays.
            enable: flavor.privacyScreen !== false,
            imageName: 'Splash',
            preventScreenshots: false,
        },
        CapacitorUpdater: otaPluginConfig,
    },
};

export default config;
