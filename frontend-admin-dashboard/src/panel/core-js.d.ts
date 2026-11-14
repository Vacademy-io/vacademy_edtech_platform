// Ambient declarations for the panel bundle. This is a SCRIPT .d.ts (no import /
// export), so the wildcard module and the globals below are global.

/** Side-effect-only core-js@3.44.0 entry points (src/panel/polyfills.ts). */
declare module 'core-js/actual/*';

/** The pdfjs legacy worker is imported for its side effects only. */
declare module 'pdfjs-dist/legacy/build/pdf.worker.js';

interface PanelEnv {
    chromeMajor: number | null;
    min: number;
    ua: string;
    missing: string[];
    syntaxOk: boolean;
    native: boolean;
    unsupported: boolean;
    at: number;
}

interface Window {
    __PANEL_ENV__?: PanelEnv;
    __PANEL_ERRORS__?: string[];
    __PANEL_UNSUPPORTED__?: boolean;
    __PANEL_BOOTED__?: boolean;
    __PANEL_BOOT_MS__?: number;
    /** Set by PanelRootErrorBoundary; the panel.html watchdog stands down. */
    __PANEL_BOOT_FAILED__?: boolean;
    /** Set by the panel.html watchdog when its card was shown ONLY because of the 20 s timeout. */
    __PANEL_BOOT_TIMED_OUT__?: boolean;
    __PANEL_DEBUG__?: Record<string, unknown>;
    /** Shows the plain-HTML "could not start" card from panel.html (idempotent). */
    __PANEL_SHOW_FAILED__?: (reason: string) => void;
}

/** Injected by vite.panel.config.ts `define`. */
declare const __PANEL_BUILD__: {
    version: string;
    gitSha: string;
    builtAt: string;
    target: string;
};
