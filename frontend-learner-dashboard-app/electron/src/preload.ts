import { contextBridge, ipcRenderer } from 'electron';

// Expose notification APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Notification methods
  showNotification: (notificationData: any) => ipcRenderer.invoke('show-notification', notificationData),
  checkNotificationPermission: () => ipcRenderer.invoke('check-notification-permission'),
  getNotificationSettings: () => ipcRenderer.invoke('get-notification-settings'),

  // Badge methods
  setBadgeCount: (count: number) => ipcRenderer.invoke('set-badge-count', count),
  clearBadge: () => ipcRenderer.invoke('clear-badge'),
  
  // Listen for notification events
  onNotification: (callback: (notification: any) => void) => {
    ipcRenderer.on('notification-received', (event, notification) => callback(notification));
  },
  
  // Listen for notification clicks
  onNotificationClicked: (callback: (data: any) => void) => {
    ipcRenderer.on('notification-clicked', (event, data) => callback(data));
  },

  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

/**
 * Tells the web layer which kind of shell it is running inside.
 *
 * `macAppStore` drives the App Store reader-app gate (Guideline 3.1.1) in
 * src/utils/ios-iap-compliance.ts. That gate used to rely solely on the
 * build-time `__MAC_APP_STORE__` constant, which is baked into the JS bundle —
 * and the whole point of OTA is that the JS bundle gets replaced. A bundle from
 * the shared learner stream is built WITHOUT that flag, so the first OTA would
 * silently switch commerce back on inside the store app and put the listing at
 * risk under Guideline 2.3.1.
 *
 * Reading it from the SHELL instead makes it survive every bundle swap: the MAS
 * package reports true forever, and the DMG / Windows / web builds report false,
 * which is exactly the DMG-vs-MAS distinction the build-time flag was chosen for.
 * `process.mas` is set by Electron only for Mac App Store builds.
 */
contextBridge.exposeInMainWorld('vacademyShell', {
  macAppStore: process.mas === true,
  windowsStore: process.windowsStore === true,
  /**
   * In-app BBB live class (contract: src/lib/live-class/native-live-class.ts, handlers:
   * electron/src/live-class.ts). The web code hosts classes inside the app ONLY when
   * `liveClass.version >= 1` is present, so shells without this keep opening classes in
   * the system browser. Bump `version` only for a change the web code must gate on.
   *
   * This preload runs in the main window's top frame only (no nodeIntegrationInSubFrames
   * anywhere), so the BBB <iframe> never sees vacademyShell or ipcRenderer.
   */
  liveClass: {
    version: 1,
    enterClass: (title?: string): Promise<void> =>
      ipcRenderer.invoke('live-class:enter', typeof title === 'string' ? title : undefined),
    exitClass: (): Promise<void> => ipcRenderer.invoke('live-class:exit'),
  },
});

require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below
console.log('User Preload!');
