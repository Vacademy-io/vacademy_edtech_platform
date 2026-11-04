/**
 * Panel-only i18next setup. Never imports '@/i18n' (it fetches merged catalogs
 * from /locales/_merged and needs the whole public/ folder).
 *
 * Namespaces:
 *   panel       — src/panel/i18n/panel.{en,hi}.json (shell, login, home, diagnostics)
 *   whiteboard  — src/panel/whiteboard/strings.ts
 *   volt        — src/panel/volt/strings.ts
 *   content     — src/panel/content/strings.ts
 *   studyLibraryDeckPlayer, fileVideoPlayer — the reused admin players; fetched
 *     on demand from ./locales/<lng>/<ns>.json (emitted by vite.panel.config.ts)
 *     with ensureNamespaces() BEFORE those players mount.
 *
 * All bundled namespaces are initialised synchronously (no network wait).
 */
import i18next, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SHARED_STORAGE_KEYS } from '../config';
import { readString, writeString } from '../lib/storage';
import { strings as whiteboardStrings } from '../whiteboard/strings';
import { strings as voltStrings } from '../volt/strings';
import { strings as contentStrings } from '../content/strings';
import panelEn from './panel.en.json';
import panelHi from './panel.hi.json';

export type PanelLanguage = 'en' | 'hi';
export const PANEL_LANGUAGES: readonly PanelLanguage[] = ['en', 'hi'];

export const PANEL_NAMESPACES = ['panel', 'whiteboard', 'volt', 'content'] as const;

function initialLanguage(): PanelLanguage {
    const saved = readString(SHARED_STORAGE_KEYS.locale);
    return saved === 'hi' ? 'hi' : 'en';
}

export function initPanelI18n(): void {
    if (i18next.isInitialized) return;
    const resources: Resource = {
        en: {
            panel: panelEn,
            whiteboard: whiteboardStrings.en,
            volt: voltStrings.en,
            content: contentStrings.en,
        },
        hi: {
            panel: panelHi,
            whiteboard: whiteboardStrings.hi,
            volt: voltStrings.hi,
            content: contentStrings.hi,
        },
    };
    const lng = initialLanguage();
    void i18next.use(initReactI18next).init({
        lng,
        fallbackLng: 'en',
        resources,
        ns: [...PANEL_NAMESPACES],
        defaultNS: 'panel',
        interpolation: { escapeValue: false },
        // Synchronous init: resources are bundled.
        initImmediate: false,
        react: { useSuspense: false },
    });
    document.documentElement.lang = lng;
}

export function getPanelLanguage(): PanelLanguage {
    return i18next.language === 'hi' ? 'hi' : 'en';
}

export async function setPanelLanguage(lng: PanelLanguage): Promise<void> {
    writeString(SHARED_STORAGE_KEYS.locale, lng);
    document.documentElement.lang = lng;
    await i18next.changeLanguage(lng);
}

const pending: Record<string, Promise<void> | undefined> = {};

async function loadBundle(lng: string, ns: string): Promise<void> {
    if (i18next.hasResourceBundle(lng, ns)) return;
    const key = `${lng}/${ns}`;
    const existing = pending[key];
    if (existing) return existing;
    const task = fetch(`./locales/${lng}/${ns}.json`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
            if (data && typeof data === 'object')
                i18next.addResourceBundle(lng, ns, data, true, true);
        })
        .catch((error) => {
            console.warn(`[panel/i18n] could not load ${key}`, error);
        })
        .then(() => {
            pending[key] = undefined;
        });
    pending[key] = task;
    return task;
}

/**
 * Load extra (non-bundled) namespaces for the current language + English
 * fallback. Never rejects; missing files leave keys untranslated.
 * e.g. await ensureNamespaces(['studyLibraryDeckPlayer']) before mounting deck-player.
 */
export async function ensureNamespaces(namespaces: string[]): Promise<void> {
    const languages = Array.from(new Set([i18next.language || 'en', 'en']));
    await Promise.all(namespaces.flatMap((ns) => languages.map((lng) => loadBundle(lng, ns))));
}
