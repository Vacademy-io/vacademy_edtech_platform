import type { i18n as I18nInstance } from "i18next";

/**
 * react-i18next for the public site's chrome in the SITE language (see
 * CatalogueLocaleProvider in catalogue-locale.tsx, the only user).
 */

/**
 * react-i18next namespaces the public site's own chrome (buttons, empty
 * states…) reads — plus `terms`, the system words ("Course" → "कोर्स") that
 * getTerminology() reads through this clone while the provider's site term
 * scope is up (sidebar/utils), so they arrive with the chrome they go into.
 */
export const SITE_I18N_NAMESPACES = ["coursePlayerA", "coursePlayerB", "productPages", "terms"] as const;

const siteInstances = new WeakMap<I18nInstance, Map<string, I18nInstance>>();

/**
 * The app's i18next instance, cloned and pinned to one site language.
 *
 * A clone shares the loaded catalogs (nothing is downloaded twice) but keeps
 * its OWN language, so a हिन्दी site never calls the global changeLanguage or
 * the persisted 'vacademy-locale' store — both of which the logged-in app reads
 * (dashboard language, Accept-Language). One clone per language, reused for
 * the whole session.
 */
export const siteI18nInstance = (base: I18nInstance, locale: string): I18nInstance => {
  let byLocale = siteInstances.get(base);
  if (!byLocale) {
    byLocale = new Map();
    siteInstances.set(base, byLocale);
  }
  let instance = byLocale.get(locale);
  if (!instance) {
    const baseNs = base.options?.ns;
    const ns = Array.from(
      new Set([...(Array.isArray(baseNs) ? baseNs : baseNs ? [baseNs] : []), ...SITE_I18N_NAMESPACES]),
    );
    // `ns` makes the clone load the site's namespaces for its language as it
    // starts; initAsync:false starts that now instead of on the next tick.
    instance = base.cloneInstance({ lng: locale, ns, initAsync: false });
    byLocale.set(locale, instance);
  }
  return instance;
};

/**
 * Events the app emits on its own instance that mounted translations must
 * follow — the institute renaming "Course" (naming-terms) rewrites the shared
 * catalogs and announces it there. Never the language events: the clone has
 * its own language.
 */
export const forwardedEvents = (base: I18nInstance): string[] => {
  const bind = base.options?.react?.bindI18n;
  return typeof bind === "string"
    ? bind.split(" ").filter((e) => e && e !== "languageChanged" && e !== "languageChanging")
    : [];
};
