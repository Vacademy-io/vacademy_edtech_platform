import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import {
  CapElectronEventEmitter,
  CapacitorSplashScreen,
  setupCapacitorElectronPlugins,
} from '@capacitor-community/electron';
import chokidar from 'chokidar';
import type { MenuItemConstructorOptions } from 'electron';
import { app, BrowserWindow, Menu, MenuItem, nativeImage, Tray, session, globalShortcut, Notification, ipcMain, shell } from 'electron';
import electronIsDev from 'electron-is-dev';
import electronServe from 'electron-serve';
import windowStateKeeper from 'electron-window-state';
import { join } from 'path';
import notifier from 'node-notifier';
import { readFileSync } from 'fs';
import { getActiveWebDirectory } from './ota';

// Read flavor from electron-flavor.json to determine branding
const flavorBranding: Record<string, { appName: string; iconBase: string }> = {
  ssdc: { appName: 'SSDC Horizon', iconBase: 'ssdc_horizon' },
  shikshanation: { appName: 'Shiksha Nation', iconBase: 'shiksha_nation' },
  zoe: { appName: 'ZOE Online School', iconBase: 'zoe' },
};
let currentFlavor = 'ssdc';
try {
  // __dirname is build/src/ after tsc compiles; electron-flavor.json is at project root
  const raw = readFileSync(join(__dirname, '..', '..', 'electron-flavor.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  if (parsed?.flavor && flavorBranding[parsed.flavor]) {
    currentFlavor = parsed.flavor;
  }
} catch {}
const brandInfo = flavorBranding[currentFlavor];

// Define components for a watcher to detect when the webapp is changed so we can reload in Dev mode.
const reloadWatcher = {
  debouncer: null,
  ready: false,
  watcher: null,
};
export function setupReloadWatcher(electronCapacitorApp: ElectronCapacitorApp): void {
  reloadWatcher.watcher = chokidar
    .watch(join(app.getAppPath(), 'app'), {
      ignored: /[/\\]\./,
      persistent: true,
    })
    .on('ready', () => {
      reloadWatcher.ready = true;
      globalShortcut.register('Control+Shift+I', () => {
        // When the user presses Ctrl + Shift + I, this function will get called
        // You can modify this function to do other things, but if you just want
        // to disable the shortcut, you can just return false
        return false;
    });
    })
    .on('all', (_event, _path) => {
      if (reloadWatcher.ready) {
        clearTimeout(reloadWatcher.debouncer);
        reloadWatcher.debouncer = setTimeout(async () => {
          electronCapacitorApp.getMainWindow().webContents.reload();
          reloadWatcher.ready = false;
          clearTimeout(reloadWatcher.debouncer);
          reloadWatcher.debouncer = null;
          reloadWatcher.watcher = null;
          setupReloadWatcher(electronCapacitorApp);
        }, 1500);
      }
    });
}

// Define our class to manage our app.
export class ElectronCapacitorApp {
  private MainWindow: BrowserWindow | null = null;
  private SplashScreen: CapacitorSplashScreen | null = null;
  private TrayIcon: Tray | null = null;
  private CapacitorFileConfig: CapacitorElectronConfig;
  private TrayMenuTemplate: (MenuItem | MenuItemConstructorOptions)[] = [
    new MenuItem({ label: 'Quit App', role: 'quit' }),
  ];
  private AppMenuBarMenuTemplate: (MenuItem | MenuItemConstructorOptions)[] = [
    { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
    { role: 'viewMenu' },
  ];
  private mainWindowState;
  private loadWebApp;
  private static pluginsLinked = false;
  private customScheme: string;

  constructor(
    capacitorFileConfig: CapacitorElectronConfig,
    trayMenuTemplate?: (MenuItemConstructorOptions | MenuItem)[],
    appMenuBarMenuTemplate?: (MenuItemConstructorOptions | MenuItem)[]
  ) {
    this.CapacitorFileConfig = capacitorFileConfig;

    this.customScheme = this.CapacitorFileConfig.electron?.customUrlScheme ?? 'capacitor-electron';

    if (trayMenuTemplate) {
      this.TrayMenuTemplate = trayMenuTemplate;
    }

    if (appMenuBarMenuTemplate) {
      this.AppMenuBarMenuTemplate = appMenuBarMenuTemplate;
    }

    // Setup our web app loader, this lets us load apps like react, vue, and angular without changing their build chains.
    // Store builds (Mac App Store / Microsoft Store) cannot self-update, so they
    // patch by swapping the WEB BUNDLE instead — see ota.ts. This resolves to the
    // packaged app/ directory for every other build, and also whenever no OTA
    // bundle is staged or a staged one turns out to be unusable.
    this.loadWebApp = electronServe({
      directory: getActiveWebDirectory(join(app.getAppPath(), 'app')),
      scheme: this.customScheme,
    });

    // Setup notification handlers
    this.setupNotificationHandlers();
  }

  private setupNotificationHandlers(): void {
    // Handle show notification requests from renderer
    ipcMain.handle('show-notification', (event, notificationData) => {
      this.showNotification(notificationData);
    });

    // Handle notification permission check
    ipcMain.handle('check-notification-permission', () => {
      return 'granted'; // Desktop notifications are always available
    });

    // Handle notification settings
    ipcMain.handle('get-notification-settings', () => {
      return {
        enabled: true,
        sound: true,
        badge: true
      };
    });

    // Handle badge count updates
    ipcMain.handle('set-badge-count', (event, count) => {
      this.setBadgeCount(count);
      return true;
    });

    // Handle clearing badges
    ipcMain.handle('clear-badge', () => {
      this.setBadgeCount(0);
      return true;
    });
  }

  private showNotification(notificationData: any): void {
    const { title, body, imageUrl, actionUrl } = notificationData;

    try {
      // Use Electron's built-in Notification API (Windows 10+, macOS)
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: title || 'Vacademy Learner',
          body: body || '',
          icon: imageUrl || join(app.getAppPath(), 'assets', 'icon-192.webp'),
          silent: false,
          urgency: 'normal'
        });

        notification.on('click', () => {
          // Bring app to focus when notification is clicked
          if (this.MainWindow) {
            this.MainWindow.show();
            this.MainWindow.focus();
          }

          // Handle action URL if provided
          if (actionUrl && this.MainWindow) {
            this.MainWindow.webContents.send('notification-clicked', { actionUrl });
          }
        });

        notification.show();
      } else {
        // Fallback to node-notifier for older systems
        notifier.notify({
          title: title || 'Vacademy Learner',
          message: body || '',
          icon: imageUrl || join(app.getAppPath(), 'assets', 'icon-192.webp'),
          sound: true,
          wait: false,
          timeout: 10
        }, (err, response, metadata) => {
          if (err) {
            console.error('Notification error:', err);
          }
          
          // Handle notification click
          if (response === 'activate') {
            if (this.MainWindow) {
              this.MainWindow.show();
              this.MainWindow.focus();
            }
          }
        });
      }
    } catch (error) {
      console.error('Error showing notification:', error);
    }
  }

  private setBadgeCount(count: number): void {
    try {
      if (process.platform === 'darwin') {
        app.setBadgeCount(count);
      } else if (process.platform === 'win32') {
        // Windows doesn't support badge count in the same way
        // but we can update the window title to show unread count
        if (this.MainWindow) {
          const baseTitle = brandInfo.appName;
          const appVersion = app.getVersion();
          const title = count > 0 ? `${baseTitle} v${appVersion} (${count})` : `${baseTitle} v${appVersion}`;
          this.MainWindow.setTitle(title);
        }
      }
    } catch (error) {
      console.error('Error setting badge count:', error);
    }
  }

  // Helper function to load in the app.
  private async loadMainWindow(thisRef: any) {
    await thisRef.loadWebApp(thisRef.MainWindow);
  }

  // Expose the mainWindow ref for use outside of the class.
  getMainWindow(): BrowserWindow {
    return this.MainWindow;
  }

  getCustomURLScheme(): string {
    return this.customScheme;
  }

  async init(): Promise<void> {
    const icon = nativeImage.createFromPath(
      join(app.getAppPath(), 'assets', process.platform === 'win32' ? `${brandInfo.iconBase}.ico` : `${brandInfo.iconBase}.png`)
    );
    this.mainWindowState = windowStateKeeper({
      defaultWidth: 1000,
      defaultHeight: 800,
    });
    const appVersion = app.getVersion();

    // Setup preload script path and construct our main window.
    const preloadPath = join(app.getAppPath(), 'build', 'src', 'preload.js');
    this.MainWindow = new BrowserWindow({
      icon,
      show: false,
      x: this.mainWindowState.x,
      y: this.mainWindowState.y,
      title: `${brandInfo.appName} v${appVersion}`,
      width: this.mainWindowState.width,
      height: this.mainWindowState.height,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        devTools: true,
        webSecurity: false, // Allow cross-origin iframes (for YouTube)
        allowRunningInsecureContent: false,
        // Use preload to inject the electron varriant overrides for capacitor plugins.
        // preload: join(app.getAppPath(), "node_modules", "@capacitor-community", "electron", "dist", "runtime", "electron-rt.js"),
        preload: preloadPath,
      },
    });
    this.mainWindowState.manage(this.MainWindow);
    this.MainWindow.setContentProtection(true);

    if (this.CapacitorFileConfig.backgroundColor) {
      this.MainWindow.setBackgroundColor(this.CapacitorFileConfig.electron.backgroundColor);
    }

    // If we close the main window with the splashscreen enabled we need to destory the ref.
    this.MainWindow.on('closed', () => {
      if (this.SplashScreen?.getSplashWindow() && !this.SplashScreen.getSplashWindow().isDestroyed()) {
        this.SplashScreen.getSplashWindow().close();
      }
    });

    // When the tray icon is enabled, setup the options.
    if (this.CapacitorFileConfig.electron?.trayIconAndMenuEnabled) {
      this.TrayIcon = new Tray(icon);
      this.TrayIcon.on('double-click', () => {
        if (this.MainWindow) {
          if (this.MainWindow.isVisible()) {
            this.MainWindow.hide();
          } else {
            this.MainWindow.show();
            this.MainWindow.focus();
          }
        }
      });
      this.TrayIcon.on('click', () => {
        if (this.MainWindow) {
          if (this.MainWindow.isVisible()) {
            this.MainWindow.hide();
          } else {
            this.MainWindow.show();
            this.MainWindow.focus();
          }
        }
      });
      // Set tooltip to display name
      this.TrayIcon.setToolTip(brandInfo.appName);
      this.TrayIcon.setContextMenu(Menu.buildFromTemplate(this.TrayMenuTemplate));
    }

    // Setup the main manu bar at the top of our window.
    Menu.setApplicationMenu(Menu.buildFromTemplate(this.AppMenuBarMenuTemplate));

    // If the splashscreen is enabled, show it first while the main window loads then switch it out for the main window, or just load the main window from the start.
    if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
      this.SplashScreen = new CapacitorSplashScreen({
        imageFilePath: join(
          app.getAppPath(),
          'assets',
          this.CapacitorFileConfig.electron?.splashScreenImageName ?? 'splash.png'
        ),
        windowWidth: 400,
        windowHeight: 400,
      });
      this.SplashScreen.init(this.loadMainWindow, this);
    } else {
      this.loadMainWindow(this);
    }

    // Security - open external URLs in system browser, allow internal navigation
    this.MainWindow.webContents.setWindowOpenHandler((details) => {
      const url = details.url;

      // OAuth URLs: open in a managed child BrowserWindow so we can intercept the token redirect
      if (url.includes('/oauth2/authorization/') || url.includes('/auth/google') || url.includes('/auth/github')) {
        this.openOAuthWindow(url);
        return { action: 'deny' };
      }

      if (!url.includes(this.customScheme)) {
        // Open external URLs (BBB, Zoom, YouTube, etc.) in the default system browser
        shell.openExternal(url);
        return { action: 'deny' };
      } else {
        return { action: 'allow' };
      }
    });
    this.MainWindow.webContents.on('will-navigate', (event, _newURL) => {
      if (!this.MainWindow.webContents.getURL().includes(this.customScheme)) {
        event.preventDefault();
      }
    });

    // Link electron plugins into the system — ONCE per process. init() runs again
    // from the `activate` handler after the user closes the window with the red
    // button and re-clicks the Dock icon (macOS keeps the app alive), and
    // setupCapacitorElectronPlugins() registers an ipcMain.handle() per plugin
    // method; a second registration throws "Attempted to register a second
    // handler for 'OfflineMedia-getFreeDiskSpace'", which surfaced as an
    // unhandled-rejection dialog with no window behind it (SN Mac 1.0.1).
    if (!ElectronCapacitorApp.pluginsLinked) {
      setupCapacitorElectronPlugins();
      ElectronCapacitorApp.pluginsLinked = true;
    }

    // When the web app is loaded we hide the splashscreen if needed and show the mainwindow.
    this.MainWindow.webContents.on('dom-ready', () => {
      if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
        this.SplashScreen.getSplashWindow().hide();
      }
      if (!this.CapacitorFileConfig.electron?.hideMainWindowOnLaunch) {
        this.MainWindow.show();
      }
      setTimeout(() => {
        if (electronIsDev) {
          this.MainWindow.webContents.openDevTools();
        }
        CapElectronEventEmitter.emit('CAPELECTRON_DeeplinkListenerInitialized', '');
      }, 400);
    });
  }

  /**
   * Opens an OAuth URL in a managed child BrowserWindow.
   * Monitors the redirect for access/refresh tokens, passes them
   * to the main window via executeJavaScript (localStorage), then closes.
   */
  private openOAuthWindow(url: string): void {
    const oauthWindow = new BrowserWindow({
      width: 600,
      height: 700,
      parent: this.MainWindow,
      modal: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    oauthWindow.loadURL(url);

    // Monitor all navigation events for the OAuth callback with tokens
    const checkForTokens = (_event: any, navUrl: string) => {
      try {
        const parsed = new URL(navUrl);
        const accessToken = parsed.searchParams.get('accessToken');
        const refreshToken = parsed.searchParams.get('refreshToken');
        const error = parsed.searchParams.get('error');

        if (accessToken && refreshToken) {
          // Build token result and pass to main window
          const result = {
            type: 'oauth_success',
            data: { accessToken, refreshToken },
            ts: Date.now(),
            isModalLogin: false,
          };
          const jsonStr = JSON.stringify(result);
          // Write to localStorage and dispatch storage event so LoginForm picks it up
          this.MainWindow.webContents.executeJavaScript(`
            localStorage.setItem('OAUTH_RESULT', ${JSON.stringify(jsonStr)});
            window.dispatchEvent(new StorageEvent('storage', {
              key: 'OAUTH_RESULT',
              newValue: ${JSON.stringify(jsonStr)},
            }));
          `);
          oauthWindow.close();
          return;
        }

        if (error === 'true') {
          const signupData = parsed.searchParams.get('signupData');
          const emailVerified = parsed.searchParams.get('emailVerified');
          const state = parsed.searchParams.get('state');

          let result: any;
          if (signupData) {
            let decodedSignupData = null;
            try { decodedSignupData = JSON.parse(atob(signupData)); } catch { /* ignore */ }
            result = {
              type: 'oauth_signup_needed',
              data: { signupData: decodedSignupData, state, emailVerified: emailVerified === 'true' },
              ts: Date.now(),
              isModalLogin: false,
            };
          } else {
            result = {
              type: 'oauth_error',
              data: { message: 'We could not find a user for the credentials used. Please sign up or contact the administrator.' },
              ts: Date.now(),
              isModalLogin: false,
            };
          }
          const jsonStr = JSON.stringify(result);
          this.MainWindow.webContents.executeJavaScript(`
            localStorage.setItem('OAUTH_RESULT', ${JSON.stringify(jsonStr)});
            window.dispatchEvent(new StorageEvent('storage', {
              key: 'OAUTH_RESULT',
              newValue: ${JSON.stringify(jsonStr)},
            }));
          `);
          oauthWindow.close();
          return;
        }
      } catch {
        // URL parsing failed — not a callback URL, let navigation continue
      }
    };

    oauthWindow.webContents.on('will-redirect', checkForTokens);
    oauthWindow.webContents.on('will-navigate', checkForTokens);

    // Also check after page finishes loading (some OAuth flows don't trigger will-redirect)
    oauthWindow.webContents.on('did-navigate', checkForTokens);
  }
}

export function setupContentSecurityPolicy(customScheme: string): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // !!! WARNING: This CSP is INSECURE and for debugging ONLY !!!
    const insecureCsp = `default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src *; frame-src * https://www.youtube.com https://www.youtube-nocookie.com`;

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [insecureCsp],
        'Cross-Origin-Opener-Policy': ['same-origin-allow-popups'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
      },
    });
  });

  // YouTube Error 153 fix - applies to all platforms
  // Adds proper headers for YouTube iframe requests
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    // Only modify YouTube iframe embed requests (not video chunks or other resources)
    if (details.url.includes('youtube.com/embed/')) {
      const modifiedHeaders = { ...details.requestHeaders };
      
      // Set Origin to localhost for Electron (YouTube accepts this)
      modifiedHeaders['Origin'] = 'http://localhost';
      
      // Set Referer to localhost if not already present
      if (!modifiedHeaders['Referer']) {
        modifiedHeaders['Referer'] = 'http://localhost/';
      }
      
      callback({ requestHeaders: modifiedHeaders });
    } else {
      // Don't modify other requests
      callback({ requestHeaders: details.requestHeaders });
    }
  });
}
