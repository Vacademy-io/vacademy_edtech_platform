import { initSafeArea } from './safeArea';
import { initStatusBar } from './statusBar';
import { initKeyboard } from './keyboard';
import { initDeepLinks } from './deepLinks';
import { initOTA as initCapgoOTA } from './ota';
import { initSelfHostedOTA } from './otaSelfHosted';
import { initPrivacyScreen } from './privacyScreen';
import { hideSplash } from './splashScreen';
import { App } from '@capacitor/app';
import { isNative } from './platform';
import { getFlavor } from './flavor';

// Defense-in-depth: a `:fast` cap-sync without a matching rebuild can produce a
// binary whose baked flavor (import.meta.env.VITE_CAP_FLAVOR) disagrees with the
// installed native appId — which silently mis-routes (/vim vs full portal) and
// picks the wrong OTA channel. Surface it loudly instead of failing quietly.
async function verifyFlavorMatchesBinary(): Promise<void> {
    try {
        const info = await App.getInfo();
        const expected = getFlavor().appId;
        if (info?.id && expected && info.id !== expected) {
            console.error(
                `[native] Flavor mismatch: bundle baked for "${getFlavor().key}" (${expected}) ` +
                    `but installed app id is ${info.id}. Re-run a flavored build before cap sync.`
            );
        }
    } catch {
        // App.getInfo unavailable — skip.
    }
}

// OTA delivery is flavor-specific:
//   - capgo:       autoUpdate cloud bundles (Vimotion). Listens for plugin events.
//   - self-hosted: our admin-core OTA backend (Vacademy Admin, learner-app style).
async function initOTAForFlavor(): Promise<void> {
    const mode = getFlavor().ota;
    if (mode === 'capgo') return initCapgoOTA();
    if (mode === 'self-hosted') return initSelfHostedOTA();
}

// Single entry point called from index.tsx BEFORE React renders. Everything
// here is a no-op on web (each helper guards with isNative()) except safe-area
// + keyboard, which set CSS variables that the responsive web build also uses
// for consistent mobile layout.
export async function initNative(): Promise<void> {
    initSafeArea();
    initKeyboard();
    if (!isNative()) return;
    await Promise.allSettled([
        initStatusBar(),
        initDeepLinks(),
        initPrivacyScreen(),
        initOTAForFlavor(),
        verifyFlavorMatchesBinary(),
    ]);
}

// Called from the vim shell after first paint, so the splash never reveals a
// blank WebView. Must be invoked exactly once per app lifetime.
export { hideSplash };
export { isNative, isIOS, isAndroid, getPlatform } from './platform';
export { setStatusBar } from './statusBar';
export { registerForPush } from './pushNotifications';
export {
    getFlavor,
    shouldForceVimShell,
    shouldForceEvalezyShell,
    getFlavorInstituteId,
} from './flavor';
