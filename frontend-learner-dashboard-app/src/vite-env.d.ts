/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HIDE_MODE_CHANGE_BUTTON?: string;
  readonly VITE_CASHFREE_SANDBOX?: string;
  /** https origin of the YouTube embed bridge (functions/embed/[videoId].ts). */
  readonly VITE_YOUTUBE_BRIDGE_ORIGIN?: string;
  /** Admin dashboard origins allowed to drive the editor preview, comma
   *  separated (-utils/preview-bridge.ts). Unset = any parent frame. */
  readonly VITE_PREVIEW_ADMIN_ORIGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by Vite `define` from package.json — the embedded JS bundle version.
declare const __APP_VERSION__: string;

// Injected by Vite `define`. True only in a Mac App Store build.
declare const __MAC_APP_STORE__: boolean;

// Injected by Vite `define`. The white-label appId of an Electron build
// (e.g. "com.zoeedtech.app"); empty string on web and mobile.
declare const __ELECTRON_APP_ID__: string;
