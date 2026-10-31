// src/i18n.ts — i18next bootstrap (BCP-47 locales, lazy-loaded catalogs).
//
// Catalogs live in public/locales/<locale>/<namespace>.json and are fetched on
// demand by the inline backend below, so adding a language never grows the
// main bundle.
//
// They live in public/ (served as static files) rather than src/ (bundled)
// deliberately: as src/ modules the ~3,200 catalogs entered the Rollup graph
// and each became its own chunk, which added ~1.2 GB to the build's peak
// memory (4.9 GB vs 3.7 GB measured) and pushed dist from ~900 to ~4,100
// files. That was enough to make the CI builder thrash in `rendering chunks`.
// Keep them out of the graph.
import i18n from 'i18next';
import type { BackendModule, ReadCallback } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, normalizeLocale } from './i18n/locales';
import {
    NAMING_TERMS_CHANGED_EVENT,
    applyNamingTerms,
    installNamingTermsSync,
} from './i18n/naming-terms';

/** Must match the zustand persist key in stores/localization/useLanguageStore. */
const LOCALE_STORAGE_KEY = 'vacademy-locale';

/**
 * Reads the locale persisted by useLanguageStore (zustand persist envelope:
 * `{"state":{"locale":"en"},"version":0}`). Read directly from localStorage so
 * i18n init stays dependency-free and runs before any store code.
 */
function getPersistedLocale(): string | null {
    try {
        const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { state?: { locale?: unknown } };
        return typeof parsed?.state?.locale === 'string' ? parsed.state.locale : null;
    } catch {
        return null;
    }
}

/** Initial language: persisted choice → browser language → 'en'. */
const initialLocale = normalizeLocale(
    getPersistedLocale() ?? (typeof navigator !== 'undefined' ? navigator.language : null)
);

/**
 * Inline lazy backend. Production builds carry one merged catalog per locale
 * (locales/_merged/<lng>.json, emitted by the merged-locale-catalogs plugin in
 * vite.config.ts); it is fetched ONCE per language and every namespace read
 * resolves from it. Per-namespace files (public/locales/<lng>/<ns>.json) are
 * the fallback — that's what dev serves, and what production degrades to if
 * the merged file is ever missing.
 *
 * Why merged-first matters: namespace loads used to race first render, and
 * anything that captured t() output before its catalog arrived — useMemo with
 * [] deps, react-query fetchers passed t — froze raw keys permanently.
 * index.tsx awaits `catalogsReady` before mounting, so with the merged file
 * the race no longer exists.
 *
 * The `?v=` cache-bust matters: files under public/ are copied to dist
 * verbatim, so unlike hashed bundle assets their URLs never change between
 * releases. Keying on the app version stops a browser serving last release's
 * catalog after a deploy.
 *
 * NOTE: `/locales/*` must stay in the `exclude` list of public/_routes.json.
 * That file routes `/*` to the Pages Function, which answers unknown paths
 * with index.html — so without the exclusion these fetches would resolve to
 * HTML and every namespace would fail to parse.
 */
const mergedCatalogs = new Map<string, Promise<Record<string, unknown> | null>>();

function loadMergedCatalog(lng: string): Promise<Record<string, unknown> | null> {
    let promise = mergedCatalogs.get(lng);
    if (!promise) {
        promise = fetch(`/locales/_merged/${lng}.json?v=${__VERSION__}`)
            .then((res) => (res.ok ? (res.json() as Promise<Record<string, unknown>>) : null))
            .catch(() => null);
        mergedCatalogs.set(lng, promise);
    }
    return promise;
}

const lazyLocaleBackend: BackendModule = {
    type: 'backend',
    init() {
        // No options needed.
    },
    read(lng: string, ns: string, callback: ReadCallback) {
        loadMergedCatalog(lng)
            .then((merged): Record<string, unknown> | Promise<Record<string, unknown>> => {
                if (merged && ns in merged) return merged[ns] as Record<string, unknown>;
                // Dev, or a namespace/locale absent from the merged file.
                return fetch(`/locales/${lng}/${ns}.json?v=${__VERSION__}`).then((res) => {
                    if (!res.ok) throw new Error(`${res.status} loading ${lng}/${ns}`);
                    return res.json() as Promise<Record<string, unknown>>;
                });
            })
            .then((data) => callback(null, applyNamingTerms(lng, ns, data)))
            .catch((error) => callback(error as Error, null));
    },
};

i18n.use(lazyLocaleBackend)
    .use(initReactI18next)
    .init({
        lng: initialLocale,
        fallbackLng: DEFAULT_LOCALE,
        supportedLngs: [...SUPPORTED_LOCALES],
        // 'en-US' resolves to 'en' instead of being rejected.
        nonExplicitSupportedLngs: true,
        load: 'languageOnly',
        defaultNS: 'common',
        ns: ['common'],
        interpolation: {
            escapeValue: false, // React already escapes.
        },
        react: {
            // Catalogs load async; don't suspend the whole tree while they do.
            useSuspense: false,
            // Re-render on institute renames too — see i18n/naming-terms.ts.
            bindI18n: `languageChanged ${NAMING_TERMS_CHANGED_EVENT}`,
        },
    });

installNamingTermsSync(i18n);

/**
 * Fetch a language's merged catalog and seed every namespace into i18next's
 * store. Seeding (not just fetching) is the load-bearing part: with resources
 * already present, useTranslation(ns) is ready on the component's FIRST
 * render — an async backend read, however fast, resolves a microtask after
 * mount, which is exactly the window where useMemo(..., []) and query-cached
 * t() captures froze raw keys.
 */
async function seedLanguage(lng: string): Promise<void> {
    const merged = await loadMergedCatalog(lng);
    if (!merged) return; // dev, or locale without a merged file — lazy path handles it
    for (const [ns, data] of Object.entries(merged)) {
        i18n.addResourceBundle(
            lng,
            ns,
            applyNamingTerms(lng, ns, data as Record<string, unknown>),
            true,
            true
        );
    }
}

/**
 * Resolves when the active language (and English, for fallback resolution) is
 * fully seeded — or immediately in dev. index.tsx awaits this, with a timeout
 * guard, before the first render.
 *
 * Runtime language SWITCHES still load namespaces from the (already cached)
 * merged file per-read; components with frozen [] memos keep the previous
 * language's strings until remount rather than showing raw keys — same
 * behaviour as before, and the remaining reason those dep arrays are still
 * worth fixing when touched.
 */
export const catalogsReady: Promise<unknown> = Promise.all([
    seedLanguage(initialLocale),
    initialLocale === DEFAULT_LOCALE ? null : seedLanguage(DEFAULT_LOCALE),
]);

export default i18n;
