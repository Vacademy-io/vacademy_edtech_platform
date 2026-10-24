import { SidebarItemsType } from "../../../../types/layout-container-types";
import {
  House,
  BookOpen,
  Scroll,
  SignOut,
  NotePencil,
  Users,
  AddressBook,
  Files,
  Password,
  UserCircle,
  UserCircleMinus,
  ClipboardText,
  DownloadSimple,
} from "@phosphor-icons/react";
import i18next, { type TFunction, type i18n as I18nInstance } from "i18next";
import {
  ContentTerms,
  NAMING_SETTINGS_KEY,
  RoleTerms,
  SystemTerms,
  type LocalizedNamingSettings,
} from "@/types/naming-settings";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type SupportedLocale,
} from "@/i18n/locales";
import { getLanguageSetting } from "@/services/language-settings";

const getNamingSettings = (): LocalizedNamingSettings[] => {
  try {
    const saved = localStorage.getItem(NAMING_SETTINGS_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to parse naming settings from localStorage:", error);
    return [];
  }
};

/* -------------------------------------------------------------------------- *
 * Locale-aware terminology resolution — mirrors the admin app's
 * components/common/layout-container/sidebar/utils.ts; keep the two in sync.
 * (The site language scope further down, and getAppTerminology, are
 * learner-only: the admin app has no public site.)
 *
 * Institutes rename terms ("Course" → "Programme") AND the UI can render in a
 * language other than the one those renames were typed in. resolveLocalizedTerm
 * covers steps (a)-(c) of the chain; it returns null when the caller must apply
 * step (d) — its own pre-existing fallback, byte-for-byte:
 *
 *   (a) term.locales[lng]                    → the institute's word for THIS locale
 *   (b) lng === content source locale        → null (flat customValue path = today)
 *   (c) i18n.t('terms:<key>')                → translated SYSTEM default
 *   (d) null                                 → caller's existing fallback
 *
 * `lng` is the app's language — or, while a public site with languages is on
 * screen, that site's language (see "Site language scope" below), except in
 * getAppTerminology, which always reads the app's.
 *
 * ENGLISH IS UNTOUCHED: with no `locales` map and no LANGUAGE_SETTING, the
 * source locale defaults to 'en', so an 'en' UI always exits at (b) with null
 * and every caller behaves exactly as it did before this file changed. The
 * terms catalog is not even fetched.
 * -------------------------------------------------------------------------- */

const TERMS_NAMESPACE = "terms";

/**
 * Active UI locale. Read off the i18next singleton rather than importing
 * "@/i18n" so this module never triggers i18n init and no import cycle is
 * possible.
 */
const getActiveLocale = (): SupportedLocale =>
  normalizeLocale(i18next.resolvedLanguage ?? i18next.language);

/** Language the institute's flat customValue/customPluralValue are written in. */
const getContentSourceLocale = (): SupportedLocale => {
  try {
    return normalizeLocale(
      getLanguageSetting()?.content_source_locale ?? DEFAULT_LOCALE
    );
  } catch {
    return DEFAULT_LOCALE;
  }
};

// Locales whose terms catalog has been requested — the namespace is fetched
// lazily and only for locales that can actually reach step (c), so an
// English-only institute never pays for it.
const requestedTermsLocales = new Set<string>();

const ensureTermsCatalog = (locale: string): void => {
  if (requestedTermsLocales.has(locale) || !i18next.isInitialized) return;
  requestedTermsLocales.add(locale);
  void i18next
    .loadNamespaces(TERMS_NAMESPACE)
    // The catalog lands after the first paint; tell consumers to re-read.
    .then(() => notifyNamingSettingsUpdated())
    .catch(() => {
      // Missing/failed catalog is non-fatal — resolution falls to step (d).
      requestedTermsLocales.delete(locale);
    });
};

/** Translated system default for a term, or null when the catalog lacks it. */
const translateTerm = (key: string, suffix?: string): string | null => {
  if (!i18next.isInitialized) return null;
  const fullKey = suffix ? `${key}_${suffix}` : key;
  if (!i18next.exists(fullKey, { ns: TERMS_NAMESPACE })) return null;
  const value = i18next.t(fullKey, { ns: TERMS_NAMESPACE, defaultValue: "" });
  return typeof value === "string" && value.length > 0 ? value : null;
};

/* --- Site language scope (public site only) ------------------------------- *
 * A site with languages renders its chrome through an i18next clone pinned to
 * the visitor's site language (CatalogueLocaleProvider) and never changes the
 * app's language, which the logged-in app keeps. Its sections still read the
 * institute's terms through getTerminology(), so without a scope the word
 * inside "View {{course}}" followed the APP's language: "Course देखें" on a
 * हिन्दी page, "View कोर्स" on an English page in a Hindi browser.
 *
 * While a scope is set, steps (a)-(c) resolve against the site language: (a)
 * the institute's word for it, (b) the flat fields when it is the content
 * source language, (c) its terms catalog, read through the site's clone. The
 * provider sets the scope before its children render and lifts it by token —
 * a page that replaced the one that set it may already have put up its own.
 *
 * With no scope (the logged-in app, sites without languages) every function
 * in this file behaves exactly as before.
 * -------------------------------------------------------------------------- */

export interface SiteTermScope {
  /** The language the site renders in (its ?lang=). */
  locale: string;
  /**
   * The site's i18next clone (catalogue-i18n-instance): pinned to `locale`
   * and sharing the app's loaded catalogs.
   */
  i18n: I18nInstance;
}

let siteTermScope: { token: object; scope: SiteTermScope } | null = null;

/**
 * Terms a site scope leaves in the app's language: the Learner word is also
 * WRITTEN into records as a person's placeholder name (the site checkout's
 * payload, the login and chatbot fallbacks), so a हिन्दी page must never
 * turn somebody's stored name into "शिक्षार्थी".
 */
const APP_LANGUAGE_TERMS: ReadonlySet<string> = new Set<string>([RoleTerms.Learner]);

/** Resolves terms against `scope` until `token` lifts it. Idempotent. */
export const setSiteTermScope = (token: object, scope: SiteTermScope): void => {
  if (siteTermScope?.token === token && siteTermScope.scope === scope) return;
  siteTermScope = { token, scope };
};

/**
 * Lifts the scope `token` set. Returns false (and lifts nothing) when another
 * token has taken over since, or there is no scope.
 */
export const clearSiteTermScope = (token: object): boolean => {
  if (siteTermScope?.token !== token) return false;
  siteTermScope = null;
  return true;
};

/**
 * Step (c) under a site scope: the SITE language's terms catalog, read
 * through the site's clone. Read only once that language's catalog is in —
 * before that, i18next would answer from the English fallback catalog and
 * beat the institute's own word at step (d).
 */
const translateSiteTerm = (
  i18n: I18nInstance,
  locale: SupportedLocale,
  key: string,
  suffix?: string
): string | null => {
  if (!i18n.hasResourceBundle(locale, TERMS_NAMESPACE)) return null;
  const fullKey = suffix ? `${key}_${suffix}` : key;
  if (!i18n.exists(fullKey, { ns: TERMS_NAMESPACE, lng: locale })) return null;
  const value = i18n.t(fullKey, { ns: TERMS_NAMESPACE, lng: locale, defaultValue: "" });
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * True when step (c) under `scope` reads nothing that is not loaded yet: the
 * site renders the content source language (step (b) answers), or that
 * language's terms catalog is in.
 */
export const siteTermsCatalogReady = (scope: SiteTermScope): boolean => {
  const locale = normalizeLocale(scope.locale);
  return (
    locale === getContentSourceLocale() ||
    scope.i18n.hasResourceBundle(locale, TERMS_NAMESPACE)
  );
};

/**
 * i18next reads a catalog once: when that read fails it marks the catalog
 * failed, and every later load of it — reloadResources() included — skips
 * it for the rest of the session. Forgets the mark, so the next load reads
 * the catalog again. The mark lives on the loader the app's instance shares
 * with its clones; a read still on its way is left alone.
 */
const forgetFailedRead = (i18n: I18nInstance, locale: string, ns: string): void => {
  const state: Record<string, number> | undefined = i18n.services?.backendConnector?.state;
  const name = `${locale}|${ns}`;
  if (state && state[name] < 0) delete state[name];
};

/**
 * Loads the site language's terms catalog through the scope's clone (the
 * clone shares the app's store, so it is fetched once) and tells consumers to
 * re-read, as ensureTermsCatalog does for the app. Resolves true once the
 * catalog is in; false when the site renders the content source language
 * (nothing to load) or the catalog could not be loaded — resolution then
 * stays at step (d).
 */
export const ensureSiteTermsCatalog = async (
  scope: SiteTermScope
): Promise<boolean> => {
  const locale = normalizeLocale(scope.locale);
  if (locale === getContentSourceLocale()) return false;
  const loaded = () => scope.i18n.hasResourceBundle(locale, TERMS_NAMESPACE);
  if (!loaded()) {
    // Named language, not loadNamespaces(): until a new clone's own
    // catalogs are in, its `language` is still the one it was cloned from.
    const load = () => scope.i18n.reloadResources([locale], [TERMS_NAMESPACE]);
    try {
      // The clone asks for the catalog as it starts, so this usually waits
      // for that read.
      await load();
      if (!loaded()) {
        // That read failed (or an earlier one did): read it once more.
        forgetFailedRead(scope.i18n, locale, TERMS_NAMESPACE);
        await load();
      }
    } catch {
      // Missing/failed catalog is non-fatal — resolution stays at step (d).
      return false;
    }
    if (!loaded()) return false;
    // The catalog lands after the first paint; tell consumers to re-read.
    notifyNamingSettingsUpdated();
  }
  return true;
};

/** The site scope `key` resolves under right now (none: the app's language). */
const activeScopeFor = (key: string): SiteTermScope | null =>
  APP_LANGUAGE_TERMS.has(key) ? null : siteTermScope?.scope ?? null;

/**
 * Steps (a)-(c) above under `site`, or in the app's language when it is
 * null. `null` means "use your own fallback" (step (d)).
 *
 * Plural reads the `_other` suffix: it is the bare plural LABEL in every
 * catalog (en "Courses", ar broken plural "دورات"), not a count-driven form.
 */
const resolveTermIn = (
  site: SiteTermScope | null,
  setting: LocalizedNamingSettings | undefined,
  key: string,
  form: "singular" | "plural"
): string | null => {
  const locale = site ? normalizeLocale(site.locale) : getActiveLocale();

  // (a) Institute's own word for the active locale. `locales` is optional —
  // blobs cached before this field existed simply have nothing here.
  const override = setting?.locales?.[locale];
  const overrideValue =
    form === "plural" ? override?.customPluralValue : override?.customValue;
  if (overrideValue) return overrideValue;

  // (b) The flat fields already hold the right language — caller's path wins.
  if (locale === getContentSourceLocale()) return null;

  // (c) Translated system default — from the site language's catalog under a
  // site scope (the provider loads it), else lazily from the app's.
  const suffix = form === "plural" ? "other" : undefined;
  if (site) return translateSiteTerm(site.i18n, locale, key, suffix);
  ensureTermsCatalog(locale);
  return translateTerm(key, suffix);
};

/**
 * Steps (a)-(c) above, under the site scope when one is up. `null` means
 * "use your own fallback" (step (d)).
 */
export const resolveLocalizedTerm = (
  setting: LocalizedNamingSettings | undefined,
  key: string,
  form: "singular" | "plural"
): string | null => resolveTermIn(activeScopeFor(key), setting, key, form);

/* --- Reactivity ----------------------------------------------------------- *
 * Same window-event contract as the admin app's useNamingSettingsVersion hook.
 * Terminology is locale-aware, so a language switch changes the same labels a
 * rename does; consumers listening for this event re-read on both.
 * -------------------------------------------------------------------------- */

export const NAMING_SETTINGS_UPDATED_EVENT = "naming-settings-updated";

export const notifyNamingSettingsUpdated = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NAMING_SETTINGS_UPDATED_EVENT));
};

i18next.on("languageChanged", () => {
  notifyNamingSettingsUpdated();
});

/** getTerminology() under `site` (null: the app's language). */
const terminologyIn = (
  site: SiteTermScope | null,
  key: string,
  defaultValue: string
): string => {
  const settings = getNamingSettings();
  const setting = settings.find((item) => item.key === key);

  // Steps (a)-(c); null → step (d), the original line below, unchanged.
  const localized = resolveTermIn(site, setting, key, "singular");
  if (localized) return localized;

  return setting?.customValue || defaultValue;
};

// Utility function to get custom terminology with fallback to default
export const getTerminology = (key: string, defaultValue: string): string =>
  terminologyIn(activeScopeFor(key), key, defaultValue);

/**
 * getTerminology() in the app's language even while a site with languages is
 * on screen — for UI outside the site's pages that renders in the app's
 * language (the chatbot, mounted at the app root). Without a site scope it is
 * getTerminology().
 */
export const getAppTerminology = (key: string, defaultValue: string): string =>
  terminologyIn(null, key, defaultValue);

// Utility function to get pluralized terminology.
// Handles two storage formats:
//  1. Raw backend format (learner): separate { key: "X_plural", customValue } entry
//  2. Admin merged format: single entry with customPluralValue field
// Falls back to naive pluralization of the singular custom value / default.
export const getTerminologyPlural = (
  key: string,
  defaultValue: string
): string => {
  const settings = getNamingSettings();

  // Steps (a)-(c); null → step (d), the original body below, unchanged.
  // Only the `key` entry carries per-locale overrides (the merged shape the
  // backend writes); a format-1 `<key>_plural` entry is source-language only.
  // naivePluralize is English-only, so reaching it for a non-English locale
  // would mangle the word — that is exactly what step (c) prevents.
  const localized = resolveLocalizedTerm(
    settings.find((item) => item.key === key),
    key,
    "plural"
  );
  if (localized) return localized;

  // Format 1: explicit _plural entry from backend
  const pluralEntry = settings.find((item) => item.key === `${key}_plural`);
  if (pluralEntry?.customValue) {
    return pluralEntry.customValue;
  }

  const setting = settings.find((item) => item.key === key);

  // Format 2: merged entry with customPluralValue field
  if (setting?.customPluralValue) {
    return setting.customPluralValue;
  }

  // Fallback: naive pluralize the singular value
  const singular = setting?.customValue || defaultValue;
  return naivePluralize(singular);
};

const naivePluralize = (word: string): string => {
  if (
    word.endsWith("s") ||
    word.endsWith("x") ||
    word.endsWith("z") ||
    word.endsWith("ch") ||
    word.endsWith("sh")
  ) {
    return `${word}es`;
  }
  if (
    word.endsWith("y") &&
    !["a", "e", "i", "o", "u"].includes(
      word.charAt(word.length - 2).toLowerCase()
    )
  ) {
    return `${word.slice(0, -1)}ies`;
  }
  return `${word}s`;
};


/**
 * Removes every offline/Downloads entry from a sidebar list.
 *
 * Offline is native-only AND admin-gated, so the nav entry must disappear on
 * web and whenever the institute has the feature switched off — otherwise the
 * learner is offered a Downloads screen that can never hold anything. Applied
 * at the single render choke point in mySidebar so it catches both the
 * top-level item and the study-library sub-item.
 */
export const stripOfflineEntries = (items: SidebarItemsType[]): SidebarItemsType[] =>
  items
    .filter((item) => item.to !== "/downloads")
    .map((item) =>
      item.subItems
        ? { ...item, subItems: item.subItems.filter((s) => s.subItemLink !== "/downloads") }
        : item
    );

export const SidebarItemsData: SidebarItemsType[] = [
  {
    icon: House,
    id: "dashboard",
    title: "Dashboard",
    to: "/dashboard",
  },
  {
    icon: BookOpen,
    id: "learning-center",
    title: "Learning Center",
    subItems: [
      {
        subItem: "Study Library",
        subItemLink: "/study-library",
      },
      {
        subItem: "Attendance",
        subItemLink: "/learning-centre/attendance",
      },
      {
        subItem: getTerminologyPlural(
          ContentTerms.LiveSession,
          SystemTerms.LiveSession
        ),
        subItemLink: "/study-library/live-class",
      },
      {
        subItem: "Downloads",
        subItemLink: "/downloads",
      },
    ],
  },
  {
    icon: NotePencil,
    id: "homework",
    title: "Homework",
    subItems: [
      {
        subItem: "Homework List",
        subItemLink: "/homework/list",
      },
      {
        subItem: "Reports",
        subItemLink: "/homework/reports",
      },
    ],
  },
  {
    icon: Users,
    id: "sub-org-learners",
    title: "Sub-Org Learners",
    to: "/sub-org-learners",
  },
  {
    icon: Scroll,
    id: "assessment-centre",
    title: "Assessment Centre",
    subItems: [
      {
        subItem: "Assessment List",
        subItemLink: "/assessment/examination",
      },
      // {
      //     subItem: "Mock Test",
      //     subItemLink: "/assessment/mock-test",
      // },
      // {
      //     subItem: "Practice Test",
      //     subItemLink: "/assessment/practice-test",
      // },
      // {
      //     subItem: "Survey",
      //     subItemLink: "/assessment/survey",
      // },
      {
        subItem: "Reports",
        subItemLink: "/assessment/reports",
      },
    ],
  },
];
// A function (not a static array) so every caller re-translates on each
// render / language change instead of freezing whatever locale was active
// the moment this module first loaded.
export const getHamBurgerSidebarItemsData = (t: TFunction): SidebarItemsType[] => [
  //TODO : add other options when api and ui is available
  {
    icon: UserCircle,
    id: "view-profile",
    title: t("sidebar.hamburgerMenu.viewProfileDetails", { ns: "layoutCommonA" }),
    to: "/user-profile",
  },
  {
    icon: Files,
    id: "my-files",
    title: t("sidebar.hamburgerMenu.myFiles", { ns: "layoutCommonA" }),
    to: "/my-files",
  },
  {
    icon: DownloadSimple,
    id: "offline-downloads",
    title: t("sidebar.hamburgerMenu.downloads", { ns: "layoutCommonA" }),
    to: "/downloads",
  },
  {
    icon: AddressBook,
    id: "my-reports",
    title: t("sidebar.hamburgerMenu.myReports", { ns: "layoutCommonA" }),
    to: "/my-reports",
  },
  {
    icon: ClipboardText,
    id: "onboarding",
    title: t("sidebar.hamburgerMenu.onboarding", { ns: "layoutCommonA" }),
    to: "/profile/onboarding",
  },
  // {
  //   icon: CreditCard,
  //   title: "Membership Details",
  //   to: "/membership-details",
  // },
  {
    icon: Password,
    id: "change-password",
    title: t("sidebar.hamburgerMenu.changePassword", { ns: "layoutCommonA" }),
    to: "/change-password",
  },
  // {
  //   icon: Headset,
  //   title: "Contact Support",
  //   to: "/support",
  // },
  {
    icon: SignOut,
    id: "logout",
    title: t("sidebar.hamburgerMenu.logOut", { ns: "layoutCommonA" }),
    to: "/logout",
  },
  {
    icon: UserCircleMinus,
    id: "delete-account",
    title: t("sidebar.hamburgerMenu.deleteAccount", { ns: "layoutCommonA" }),
    to: "/delete-user",
  },
];

// New function to filter menu items based on permissions
export async function filterHamburgerMenuItemsWithPermissions(
  HamBurgerSidebarItemsData: SidebarItemsType[],
  permissions: {
    canViewProfile: boolean;
    canEditProfile: boolean;
    canDeleteProfile: boolean;
    canViewFiles: boolean;
    canViewReports: boolean;
  }
) {
  // Filter based on permissions. Compare on stable `id`s, never on `title`
  // (display text — translated / institute-renamed).
  if (!permissions.canViewProfile) {
    HamBurgerSidebarItemsData = HamBurgerSidebarItemsData.filter(
      (item) => item.id !== "view-profile"
    );
  }

  if (!permissions.canViewFiles) {
    HamBurgerSidebarItemsData = HamBurgerSidebarItemsData.filter(
      (item) => item.id !== "my-files"
    );
  }

  if (!permissions.canViewReports) {
    HamBurgerSidebarItemsData = HamBurgerSidebarItemsData.filter(
      (item) => item.id !== "my-reports"
    );
  }

  if (!permissions.canEditProfile) {
    HamBurgerSidebarItemsData = HamBurgerSidebarItemsData.filter(
      (item) => item.id !== "change-password"
    );
  }

  if (!permissions.canDeleteProfile) {
    HamBurgerSidebarItemsData = HamBurgerSidebarItemsData.filter(
      (item) => item.id !== "delete-account"
    );
  }

  return HamBurgerSidebarItemsData;
}

/* -------------------------------------------------------------------------- *
 * "Has a daily-task plan" flag.
 *
 * Remembers, per institute, that the learner's last engagement feed had a plan
 * running. Two readers need that answer before (or without) fetching the feed:
 *  - the dashboard, which picks the Today module's slot on the first render so
 *    the main column never reflows when the feed lands;
 *  - the sidebar, which shows the "Daily tasks" entry only to learners who have
 *    tasks, without polling the feed on every page.
 * The dashboard writes it from the feed: set on a plan, cleared on a confirmed
 * "no plan". Storage can be missing or throw (private mode, cleared site data),
 * so every access is guarded and the answer then defaults to "no plan".
 * -------------------------------------------------------------------------- */

const ENGAGEMENT_PLAN_FLAG_KEY = "vacademy:engagement:plan-institutes";
/** Fired on `window` whenever the flag changes, so the sidebar updates in place. */
export const ENGAGEMENT_PLAN_FLAG_EVENT = "vacademy:engagement-plan-flag";

const readPlanInstitutes = (): string[] => {
  try {
    const raw = localStorage.getItem(ENGAGEMENT_PLAN_FLAG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
  } catch {
    return [];
  }
};

/**
 * Whether the learner's last feed for this institute had a plan. With no
 * institute id yet (still resolving), whether any institute had one — most
 * learners belong to exactly one.
 */
export const readEngagementPlanFlag = (instituteId?: string | null): boolean => {
  const ids = readPlanInstitutes();
  return instituteId ? ids.includes(instituteId) : ids.length > 0;
};

/** Record whether this institute currently has a plan. No-op without an id. */
export const writeEngagementPlanFlag = (
  instituteId: string | null | undefined,
  hasPlan: boolean
): void => {
  if (!instituteId) return;
  const ids = readPlanInstitutes();
  const had = ids.includes(instituteId);
  if (had === hasPlan) return;
  const next = hasPlan ? [...ids, instituteId] : ids.filter((id) => id !== instituteId);
  try {
    localStorage.setItem(ENGAGEMENT_PLAN_FLAG_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ENGAGEMENT_PLAN_FLAG_EVENT));
  }
};
