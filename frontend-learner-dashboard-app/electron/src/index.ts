import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, MenuItem, protocol } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import { checkAndStageOtaBundle, isWebBundleOtaShell } from './ota';

import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher } from './setup';

// Register the `offline-media://` scheme as privileged (standard + secure + fetch-API-capable
// + streaming) *before* the app is ready — Electron requires `registerSchemesAsPrivileged` to
// run at module load time, before `app.whenReady()` resolves; doing it any later throws. The
// actual `protocol.handle('offline-media', ...)` request handler is registered lazily by
// `OfflineMedia` (electron/src/offline-media-plugin.ts) the first time that plugin class is
// instantiated (via `setupCapacitorElectronPlugins()` in setup.ts, after the app is ready).
// `bypassCSP: true` because the app's dev-mode CSP in `setupContentSecurityPolicy` below is
// scoped to the main `electron-serve` scheme's session, not this one, and video `src` loads
// should never be blocked by it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'offline-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

// Graceful handling of unhandled errors.
unhandled();

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [new MenuItem({ label: 'Quit App', role: 'quit' })];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'viewMenu' },
];

// Get Config options from capacitor.config
const capacitorFileConfig: CapacitorElectronConfig = getCapacitorElectronConfig();

// Initialize our app. You can pass menu templates into the app here.
// const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig);
const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig, trayMenuTemplate, appMenuBarMenuTemplate);

// If deeplinking is enabled then we will set it up here.
if (capacitorFileConfig.electron?.deepLinkingEnabled) {
  setupElectronDeepLinking(myCapacitorApp, {
    customProtocol: capacitorFileConfig.electron.deepLinkingCustomProtocol ?? 'mycapacitorapp',
  });
}

// If we are in Dev mode, use the file watcher components.
if (electronIsDev) {
  setupReloadWatcher(myCapacitorApp);
}

// Run Application
(async () => {
  // Wait for electron app to be ready.
  await app.whenReady();
  // Security - Set Content-Security-Policy based on whether or not we are in dev mode.
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());
  // Initialize our app, build windows, and load content.
  await myCapacitorApp.init();
  // Check for updates if we are in a packaged app. Which channel depends on the package:
  //   Mac App Store  — sandboxed and store-managed, so electron-updater can never run. Patches
  //                    arrive as a new WEB BUNDLE instead (ota.ts).
  //   Microsoft Store — read-only under WindowsApps and updated by the Store itself, so a
  //                    self-update would error at best and violate Store policy at worst. No
  //                    update channel here today; ota.ts documents how to add one.
  //   everything else — the full electron-updater flow, unchanged.
  // process.mas / process.windowsStore are true ONLY for store-packaged builds, so NSIS,
  // portable and dmg builds are completely unaffected.
  if (!electronIsDev && isWebBundleOtaShell()) {
    // Mac App Store build: the native shell is frozen until the next release, so the only patch
    // channel is the web bundle. Same backend + same published bundles as iOS/Android; downloaded
    // in the background and applied on the NEXT launch, never mid-session (a WebView reload would
    // destroy an in-progress exam attempt). See ota.ts.
    void checkAndStageOtaBundle();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    setInterval(() => void checkAndStageOtaBundle(), SIX_HOURS);
  } else if (!electronIsDev && !process.windowsStore) {
    // The whole updater setup is guarded: `autoUpdater` is a lazy GETTER that constructs
    // MacUpdater/NsisUpdater on first touch, and that constructor THROWS on anything it
    // dislikes about the package — an app version that is not valid semver, for one. An
    // uncaught throw here happens before any window exists, so electron-unhandled turns it
    // into a modal error dialog and the user never sees the app at all. Auto-update is a
    // background nicety; it must never be able to keep the app from starting.
    try {
      // Silent OTA auto-update via electron-updater (feed: GitHub releases Vacademy-io/electron-build-repo,
      // see app-update.yml). "Silent" here means: pull the new build in the background the moment it's
      // published, then install it with no prompts the next time the user quits — they simply launch into
      // the new version. Microsoft Store (MSIX/AppX) builds are excluded above; they update via the Store.
      // NOTE: this only self-installs for NSIS/dmg targets (which ship latest.yml); a portable .exe has no
      // installer to run, so those users would still re-download manually.
      autoUpdater.autoDownload = true; // download the update in the background as soon as one is found
      autoUpdater.autoInstallOnAppQuit = true; // install it silently on the next quit — no user action needed

      autoUpdater.on('checking-for-update', () => {
        console.log('[updater] Checking for updates…');
      });

      autoUpdater.on('update-available', (info) => {
        console.log(`[updater] Update available: ${info.version} — downloading in background`);
      });

      autoUpdater.on('update-not-available', () => {
        console.log('[updater] No update available; already on the latest version.');
      });

      autoUpdater.on('error', (err) => {
        // Expected on unpublished/dev builds or transient network issues — never crash the app over it.
        console.log('[updater] Auto-updater error:', err?.message ?? err);
      });

      autoUpdater.on('download-progress', (progressObj) => {
        console.log(
          `[updater] Downloading update: ${Math.round(progressObj.percent)}% ` +
            `(${Math.round(progressObj.bytesPerSecond / 1024)} KB/s)`
        );
      });

      autoUpdater.on('update-downloaded', (info) => {
        // Staged and ready. autoInstallOnAppQuit applies it silently on the next quit, so there is nothing
        // to prompt here — the user just gets the new version on their next launch.
        console.log(`[updater] Update ${info.version} downloaded; will install silently on quit.`);
      });

      // Check on launch, then periodically so long-running sessions still pick up new releases.
      // Wrapped in try/catch so a missing app-update.yml or offline start never breaks app startup.
      const checkForUpdates = () => {
        try {
          void autoUpdater.checkForUpdates();
        } catch (err) {
          console.log('[updater] Update check failed:', err?.message ?? err);
        }
      };

      checkForUpdates();
      const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
      setInterval(checkForUpdates, SIX_HOURS_MS);
    } catch (err) {
      console.log('[updater] Auto-update unavailable; continuing without it:', (err as Error)?.message ?? err);
    }
  }
})();

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// When the dock icon is clicked.
app.on('activate', async function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (myCapacitorApp.getMainWindow().isDestroyed()) {
    await myCapacitorApp.init();
  }
});

// Place all ipc or other electron api calls and custom functionality under this line
