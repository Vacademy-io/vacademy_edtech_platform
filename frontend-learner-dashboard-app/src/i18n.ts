// src/i18n.ts — i18next bootstrap (BCP-47 locales, lazy-loaded catalogs).
//
// Catalogs live in src/locales/<locale>/<namespace>.json and are loaded on
// demand via the inline backend below, so adding a language never grows the
// main bundle (Vite code-splits each JSON behind the dynamic import). The
// catalogs ship inside the app bundle (never CDN-fetched) — OTA delivers
// dist/ to every tenant native app, so translations must be self-contained.
// Mirrors the admin app's src/i18n.ts.
import i18n from "i18next";
import type { BackendModule, ReadCallback } from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, normalizeLocale } from "./i18n/locales";
import {
  isChunkLoadError,
  isLazyResolverError,
  reloadForChunkError,
} from "./lib/chunk-reload";
import {
  NAMING_TERMS_CHANGED_EVENT,
  applyNamingTerms,
  installNamingTermsSync,
} from "./i18n/naming-terms";

/** Must match the zustand persist key in stores/localization/useLanguageStore. */
const LOCALE_STORAGE_KEY = "vacademy-locale";

/** Must match LANGUAGE_SETTING_STORAGE_KEY in services/language-settings.ts. */
const LANGUAGE_SETTING_STORAGE_KEY = "languageSetting";

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
    return typeof parsed?.state?.locale === "string" ? parsed.state.locale : null;
  } catch {
    return null;
  }
}

/**
 * Institute-configured default locale from the cached LANGUAGE_SETTING blob
 * (written by fetchAndStoreInstituteDetails). Read raw for the same
 * dependency-free reason as above.
 */
function getInstituteDefaultLocale(): string | null {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_SETTING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { default_locale?: unknown };
    return typeof parsed?.default_locale === "string" && parsed.default_locale
      ? parsed.default_locale
      : null;
  } catch {
    return null;
  }
}

/**
 * Initial language: persisted choice → institute default → browser language
 * → 'en'.
 */
const initialLocale = normalizeLocale(
  getPersistedLocale() ??
    getInstituteDefaultLocale() ??
    (typeof navigator !== "undefined" ? navigator.language : null)
);

/** Set once a stale-catalog reload is in flight, so i18next's read retries
 * and sibling namespaces don't each burn the shared reload budget. */
let catalogReloadRequested = false;

/**
 * Inline lazy backend — loads src/locales/<lng>/<ns>.json on demand. Written
 * inline instead of adding i18next-resources-to-backend as a dependency.
 *
 * A catalog chunk has no deps, so Vite's preload helper calls import()
 * directly and never fires vite:preloadError — and the rejection is handled
 * here, so the global unhandledrejection listener never sees it either. On a
 * tab older than the current deploy the hashed chunk URL is gone, and without
 * this the screen renders raw keys (`quizReview.title`) until a hard refresh.
 */
const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init() {
    // No options needed.
  },
  read(lng: string, ns: string, callback: ReadCallback) {
    import(`./locales/${lng}/${ns}.json`)
      .then((module) =>
        callback(null, applyNamingTerms(lng, ns, module.default ?? module))
      )
      .catch((error) => {
        // Offline also surfaces as a chunk error — reloading would only swap
        // the page for the browser's offline screen, so leave it be.
        if (
          !catalogReloadRequested &&
          navigator.onLine !== false &&
          (isChunkLoadError(error) || isLazyResolverError(error))
        ) {
          catalogReloadRequested = reloadForChunkError(error);
        }
        callback(error as Error, null);
      });
  },
};

i18n
  .use(lazyLocaleBackend)
  .use(initReactI18next)
  .init({
    lng: initialLocale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    // 'en-US' resolves to 'en' instead of being rejected.
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    defaultNS: "common",
    ns: ["common"],
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

export default i18n;
