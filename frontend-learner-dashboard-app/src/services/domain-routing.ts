import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "../constants/urls";
import { getDomainAndSubdomain } from "../utils/platform-flavor";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import themeData from "@/constants/themes/theme.json";
import { detectVisitorCountry } from "@/utils/geo-country";

export interface DomainRoutingResponse {
  instituteId: string;
  instituteName: string;
  instituteLogoFileId: string;
  instituteThemeCode: string;
  role: string;
  redirect: string;
  // New optional fields for institute policy URLs
  privacyPolicyUrl?: string | null;
  termsAndConditionUrl?: string | null;
  // Optional theme and font settings for pre-login branding
  theme?: string | null;
  fontFamily?: string | null;
  // Optional signup visibility
  allowSignup?: boolean | null;
  // Optional tab branding
  tabText?: string | null;
  tabIconFileId?: string | null;
  homeIconClickRoute?: string | null;
  // Login provider toggles
  allowGoogleAuth?: boolean | null;
  allowGithubAuth?: boolean | null;
  allowEmailOtpAuth?: boolean | null;
  allowUsernamePasswordAuth?: boolean | null;
  allowPhoneAuth?: boolean | null;
  // App Links
  playStoreAppLink?: string | null;
  appStoreAppLink?: string | null;
  windowsAppLink?: string | null;
  macAppLink?: string | null;
  learnerPortalUrl?: string | null;
  instructorPortalUrl?: string | null;
  // Optional flag to convert username and password to lowercase during login
  convertUsernamePasswordToLowercase?: boolean | null;
  // Comma-separated ISO 3166-1 alpha-2 country codes (e.g. "in,us,gb,au")
  // Drives the default selection and ordering of country options in phone inputs.
  commaSeparatedPreferredCountry?: string | null;
  // How phone inputs pick their country code on this portal - one of
  // PHONE_COUNTRY_GEO_MODES. Absent/unrecognised behaves as INSTITUTE_FIRST.
  phoneCountryGeoMode?: string | null;
  // White-label branding display settings. Default (undefined / null / false)
  // preserves existing behavior: institute name visible, logo at default size.
  hideInstituteName?: boolean | null;
  logoWidthPx?: number | null;
  logoHeightPx?: number | null;
  // When true, the institute name is stacked below the logo (centered vertical)
  // instead of beside it. Default (undefined / null / false): name beside logo.
  stackNameBelowLogo?: boolean | null;
  // Minimal naming overrides surfaced pre-login so screens like the login page
  // can honor institute-specific terminology before the full settings payload
  // is fetched post-login.
  // Tag of the catalogue mounted at this host's ROOT: when set, the site
  // answers on "/" and "/<page>" instead of "/<tag>" and "/<tag>/<page>".
  // Absent/null = classic tagged routing. See RouteMatcher.basePath().
  rootCatalogueTag?: string | null;
  namingOverrides?: {
    course?: string | null;
    coursePlural?: string | null;
    level?: string | null;
    session?: string | null;
    popularTag?: string | null;
  } | null;
}

export interface DomainRoutingError {
  status: number;
  message: string;
}

export interface CachedInstituteBranding {
  instituteId: string | null;
  instituteName: string | null;
  instituteLogoFileId: string | null;
  instituteLogoUrl: string | null;
  instituteThemeCode: string | null;
  /**
   * instituteThemeCode resolved to an actual CSS colour (primary-500).
   *
   * index.html's pre-bundle splash script cannot import theme.json, and it used
   * to assign instituteThemeCode straight to `style.background`. That is a theme
   * CODE ("primary", "holistic", "navy"), not a colour: the invalid ones
   * silently no-op, and the handful that collide with CSS named colours
   * (navy/teal/purple/pink/red) painted a completely unrelated shade. Resolving
   * it here — on the TS side, which can read theme.json — keeps the mapping in
   * one place instead of duplicating the palette into index.html.
   *
   * Custom hex brands (instituteThemeCode starting with "#") pass through.
   */
  instituteThemeHex: string | null;
  homeIconClickRoute: string | null;
  // White-label display overrides. `null` / `false` = default behavior.
  hideInstituteName: boolean | null;
  logoWidthPx: number | null;
  logoHeightPx: number | null;
  stackNameBelowLogo: boolean | null;
}

const BRANDING_CACHE_KEY = "InstituteBranding";
const PREFERRED_COUNTRIES_CACHE_KEY = "InstitutePreferredCountries";
const PHONE_COUNTRY_GEO_MODE_CACHE_KEY = "InstitutePhoneCountryGeoMode";
const ROOT_CATALOGUE_TAG_CACHE_KEY = "InstituteRootCatalogueTag";

let cachedRootCatalogueTagMemory: string | null | undefined;

/**
 * Catalogue tag mounted at this host's root, or null. Synchronous on purpose:
 * link builders (RouteMatcher, CatalogueLink, the header) run during render
 * and cannot await the resolve. Written on EVERY resolve — including a null
 * — so un-mounting a catalogue server-side takes effect on the next load
 * rather than lingering in localStorage.
 */
export const getCachedRootCatalogueTag = (): string | null => {
  if (cachedRootCatalogueTagMemory !== undefined) {
    return cachedRootCatalogueTagMemory;
  }
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem(ROOT_CATALOGUE_TAG_CACHE_KEY);
      cachedRootCatalogueTagMemory = stored && stored.trim() ? stored.trim() : null;
      return cachedRootCatalogueTagMemory;
    }
  } catch {
    // storage blocked — fall through to "not mounted"
  }
  cachedRootCatalogueTagMemory = null;
  return null;
};

export const setCachedRootCatalogueTag = (tag: string | null | undefined) => {
  const clean = (tag ?? "").trim().replace(/^\/+/, "");
  cachedRootCatalogueTagMemory = clean || null;
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (clean) {
      window.localStorage.setItem(ROOT_CATALOGUE_TAG_CACHE_KEY, clean);
    } else {
      window.localStorage.removeItem(ROOT_CATALOGUE_TAG_CACHE_KEY);
    }
  } catch (error) {
    console.warn("[Domain Routing] Failed to persist root catalogue tag:", error);
  }
};
let cachedBrandingMemory: CachedInstituteBranding | null = null;
let cachedPreferredCountriesMemory: string[] | null = null;
let cachedPhoneCountryGeoModeMemory: PhoneCountryGeoMode | null = null;

const canUseLocalStorage = (): boolean => {
  return typeof window !== "undefined" && !!window?.localStorage;
};

/**
 * Listeners notified whenever the institute's phone-country preferences change.
 *
 * {@link getPreferredPhoneCountries} is a SYNCHRONOUS read of a cache that only
 * {@link resolveDomainRouting} fills, and on public routes — the enroll-invite
 * form, the catalogue checkout, the audience/enquiry forms — nothing waits for
 * that call. The root `beforeLoad` returns early for everything in
 * `PUBLIC_ROUTES`, so the resolve is a plain async request racing the form.
 *
 * Measured on `student.elevateeducation.in/learner-invitation-response`: the
 * phone field mounts at ~1.95s and domain routing answers at ~1.93s. It wins by
 * about 30ms. Add ~2s of latency and the order flips,
 * {@link hasResolvedPhonePreferences} reads false, geo-detection is withheld
 * (correctly — an unread preference must not be overridden), and the field
 * hard-falls back to `DEFAULT_PREFERRED_COUNTRIES[0]`, showing +91 to a visitor
 * in any country. Without a subscription it never recovers, because every
 * caller reads the cache once and memoizes.
 *
 * Subscribing lets a phone field pick the answer up when it finally lands. See
 * `hooks/use-preferred-phone-countries`, which is the only intended consumer and
 * which decides what to do with each answer (the institute's reply always wins;
 * never applied under a visitor who is typing).
 */
type PhoneCountriesListener = () => void;

const phoneCountriesListeners = new Set<PhoneCountriesListener>();

const notifyPhoneCountriesChanged = (): void => {
  // Copied before iterating: a listener is free to unsubscribe during the call
  // (a React cleanup can run mid-notification), and that must not mutate the set
  // we are walking.
  for (const listener of [...phoneCountriesListeners]) {
    try {
      listener();
    } catch (error) {
      // One broken subscriber must not stop the others, and must never take
      // down the domain-routing resolve it is riding on.
      console.warn("[Domain Routing] Phone-country listener failed:", error);
    }
  }
};

/**
 * Subscribes to institute phone-preference changes. Returns an unsubscribe
 * function.
 */
export const subscribePhoneCountries = (
  listener: PhoneCountriesListener,
): (() => void) => {
  phoneCountriesListeners.add(listener);
  return () => {
    phoneCountriesListeners.delete(listener);
  };
};

/**
 * Parses a comma-separated list of country codes into a normalized lowercase array.
 * Whitespace and empty entries are stripped.
 */
const parsePreferredCountries = (
  raw: string | null | undefined
): string[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code.length > 0);
};

export const setCachedPreferredCountries = (
  raw: string | null | undefined
): void => {
  const parsed = parsePreferredCountries(raw);
  cachedPreferredCountriesMemory = parsed;

  if (canUseLocalStorage()) {
    try {
      if (parsed.length === 0) {
        window.localStorage.removeItem(PREFERRED_COUNTRIES_CACHE_KEY);
      } else {
        window.localStorage.setItem(
          PREFERRED_COUNTRIES_CACHE_KEY,
          JSON.stringify(parsed)
        );
      }
    } catch (error) {
      console.warn(
        "[Domain Routing] Failed to persist preferred countries cache:",
        error
      );
    }
  }

  // Notified even when the write failed: the in-memory cache above IS the value
  // subscribers read, so it is now current whatever localStorage did.
  notifyPhoneCountriesChanged();
};

export const getCachedPreferredCountries = (): string[] => {
  if (cachedPreferredCountriesMemory) {
    return cachedPreferredCountriesMemory;
  }

  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(PREFERRED_COUNTRIES_CACHE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      cachedPreferredCountriesMemory = parsed.filter(
        (c): c is string => typeof c === "string"
      );
      return cachedPreferredCountriesMemory;
    }
  } catch (error) {
    console.warn(
      "[Domain Routing] Failed to read preferred countries cache:",
      error
    );
  }
  return [];
};

/**
 * Last-resort country picker order, used only when the institute has configured
 * nothing AND the visitor's own country could not be detected. India ('in') is
 * first because that is where the overwhelming majority of platform traffic is.
 *
 * This is the UNION of the per-form fallbacks that existed before these lists
 * were unified — the catalogue checkout and enrolment-payment dialogs carried
 * 'ae', which somebody added deliberately for Gulf buyers. Pinning a country
 * only moves it to the top of a picker that still lists every country, so a
 * wider default can never restrict anyone; dropping one silently makes a real
 * buyer scroll. Keep this a superset when consolidating further lists.
 */
export const DEFAULT_PREFERRED_COUNTRIES = ["in", "us", "gb", "au", "ae"];

/**
 * How a portal decides which country code a phone field starts on. Stored per
 * white-label routing row (`institute_domain_routing.phone_country_geo_mode`)
 * and surfaced through domain routing. Mirrors the backend `PhoneCountryGeoMode`.
 */
export const PHONE_COUNTRY_GEO_MODES = [
  "INSTITUTE_FIRST",
  "GEO_FIRST",
  "INSTITUTE_ONLY",
] as const;

export type PhoneCountryGeoMode = (typeof PHONE_COUNTRY_GEO_MODES)[number];

export const DEFAULT_PHONE_COUNTRY_GEO_MODE: PhoneCountryGeoMode =
  "INSTITUTE_FIRST";

const normalizeGeoMode = (raw: unknown): PhoneCountryGeoMode => {
  const upper = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return PHONE_COUNTRY_GEO_MODES.includes(upper as PhoneCountryGeoMode)
    ? (upper as PhoneCountryGeoMode)
    : DEFAULT_PHONE_COUNTRY_GEO_MODE;
};

/**
 * Caches the portal's phone-country mode alongside the preferred countries, so
 * phone inputs — many of which render on public pages before any authenticated
 * fetch — can read it synchronously.
 */
export const setCachedPhoneCountryGeoMode = (
  raw: string | null | undefined,
): void => {
  const mode = normalizeGeoMode(raw);
  cachedPhoneCountryGeoModeMemory = mode;

  if (canUseLocalStorage()) {
    try {
      window.localStorage.setItem(PHONE_COUNTRY_GEO_MODE_CACHE_KEY, mode);
    } catch (error) {
      console.warn(
        "[Domain Routing] Failed to persist phone country geo mode:",
        error,
      );
    }
  }

  // This is the call that flips `hasResolvedPhonePreferences()` to true, so it
  // is the notification that actually unblocks a waiting phone field.
  notifyPhoneCountriesChanged();
};

/**
 * Whether this device has ever resolved an institute's phone preferences.
 *
 * The distinction matters because "the institute configured no countries" and
 * "we have not yet asked the institute anything" both leave
 * {@link getCachedPreferredCountries} empty, and they call for opposite
 * behaviour. Several public routes — the product-page checkout, the assessment
 * registration form — render phone fields without ever resolving domain
 * routing, so on a cold browser the institute's preference (and its
 * INSTITUTE_ONLY opt-out) is simply unknown there. Letting geo-detection fill
 * that silence would override a preference we never read.
 *
 * `setCachedPhoneCountryGeoMode` always writes a concrete value, including for
 * a null column, so the key's presence is exactly this marker.
 */
export const hasResolvedPhonePreferences = (): boolean => {
  if (cachedPhoneCountryGeoModeMemory) {
    return true;
  }
  if (!canUseLocalStorage()) {
    return false;
  }
  try {
    return window.localStorage.getItem(PHONE_COUNTRY_GEO_MODE_CACHE_KEY) !== null;
  } catch {
    return false;
  }
};

export const getCachedPhoneCountryGeoMode = (): PhoneCountryGeoMode => {
  if (cachedPhoneCountryGeoModeMemory) {
    return normalizeGeoMode(cachedPhoneCountryGeoModeMemory);
  }

  if (!canUseLocalStorage()) {
    return DEFAULT_PHONE_COUNTRY_GEO_MODE;
  }

  try {
    const stored = window.localStorage.getItem(PHONE_COUNTRY_GEO_MODE_CACHE_KEY);
    if (stored) {
      cachedPhoneCountryGeoModeMemory = normalizeGeoMode(stored);
      return cachedPhoneCountryGeoModeMemory;
    }
  } catch (error) {
    console.warn(
      "[Domain Routing] Failed to read phone country geo mode cache:",
      error,
    );
  }
  return DEFAULT_PHONE_COUNTRY_GEO_MODE;
};

/**
 * Resolves what a phone field should start on: which country is selected, and
 * how the picker is ordered.
 *
 * Two things have an opinion — the institute's configured preferred countries,
 * and the country the visitor is physically in (see `utils/geo-country`, which
 * reads the browser's timezone; no request, no IP, resolved synchronously so
 * the flag never changes under someone who has started typing).
 *
 * The portal's `phone_country_geo_mode` decides which wins:
 *
 * - `INSTITUTE_FIRST` (default) — the configured list wins outright, exactly as
 *   before this setting existed. The visitor's country is used only when the
 *   institute has configured nothing, so a form opened in Moscow starts on +7
 *   instead of hard-defaulting to +91.
 * - `GEO_FIRST` — the visitor's country is pre-selected when known; the
 *   configured list still orders the rest of the picker behind it. For
 *   institutes taking enrolments from several countries.
 * - `INSTITUTE_ONLY` — the visitor is never consulted.
 *
 * The first entry of `preferredCountries` is not assumed to be the default:
 * `defaultCountry` is returned explicitly, because under `GEO_FIRST` the
 * selected country is not necessarily one the institute listed.
 */
export type ResolvedPhoneCountries = {
  defaultCountry: string;
  preferredCountries: string[];
  /** The mode that produced this result. */
  mode: PhoneCountryGeoMode;
  /** The visitor's detected country, or null. Always null under INSTITUTE_ONLY. */
  detectedCountry: string | null;
};

/**
 * The resolution chain itself, as a pure function of its three inputs. Mirrors
 * `resolvePhoneCountries` in the admin dashboard — the two must stay in step,
 * since they decide the same thing for the same institute.
 *
 * @param mode       the portal's configured mode
 * @param configured the institute's preferred countries, in their chosen order
 * @param detected   the country the visitor is in, or null when unknown
 */
export const resolvePhoneCountries = (
  mode: PhoneCountryGeoMode,
  configured: string[],
  detected: string | null,
): ResolvedPhoneCountries => {
  // INSTITUTE_ONLY never looks at the visitor, whatever was passed in.
  const visitor = mode === "INSTITUTE_ONLY" ? null : detected;

  // Institute list first, then the platform default, so GEO_FIRST still shows
  // the institute's chosen countries immediately under the detected one.
  const base = configured.length > 0 ? configured : DEFAULT_PREFERRED_COUNTRIES;

  if (mode === "GEO_FIRST" && visitor) {
    return {
      defaultCountry: visitor,
      preferredCountries: [visitor, ...base.filter((code) => code !== visitor)],
      mode,
      detectedCountry: visitor,
    };
  }

  // INSTITUTE_FIRST, and GEO_FIRST when the visitor could not be placed: the
  // institute's own list is authoritative.
  if (configured.length > 0) {
    return {
      defaultCountry: configured[0] ?? "in",
      preferredCountries: configured,
      mode,
      detectedCountry: visitor,
    };
  }

  // Nothing configured. Follow the visitor rather than hard-defaulting to
  // India — this is the case that makes a form opened in Moscow start on +7.
  if (visitor) {
    return {
      defaultCountry: visitor,
      preferredCountries: [
        visitor,
        ...DEFAULT_PREFERRED_COUNTRIES.filter((code) => code !== visitor),
      ],
      mode,
      detectedCountry: visitor,
    };
  }

  return {
    defaultCountry: DEFAULT_PREFERRED_COUNTRIES[0] ?? "in",
    preferredCountries: DEFAULT_PREFERRED_COUNTRIES,
    mode,
    detectedCountry: null,
  };
};

/**
 * Resolves what a phone field should start on: which country is selected, and
 * how the picker is ordered.
 *
 * Two things have an opinion — the institute's configured preferred countries,
 * and the country the visitor is physically in (see `utils/geo-country`, which
 * reads the browser's timezone; no request, no IP, resolved synchronously so
 * the flag never changes under someone who has started typing).
 *
 * The portal's `phone_country_geo_mode` decides which wins:
 *
 * - `INSTITUTE_FIRST` (default) — the configured list wins outright, exactly as
 *   before this setting existed. The visitor's country is used only when the
 *   institute has configured nothing, so a form opened in Moscow starts on +7
 *   instead of hard-defaulting to +91.
 * - `GEO_FIRST` — the visitor's country is pre-selected when known; the
 *   configured list still orders the rest of the picker behind it. For
 *   institutes taking enrolments from several countries.
 * - `INSTITUTE_ONLY` — the visitor is never consulted.
 *
 * The first entry of `preferredCountries` is not assumed to be the default:
 * `defaultCountry` is returned explicitly, because under `GEO_FIRST` the
 * selected country is not necessarily one the institute listed.
 */
export const getPreferredPhoneCountries = (): ResolvedPhoneCountries =>
  resolvePhoneCountries(
    getCachedPhoneCountryGeoMode(),
    getCachedPreferredCountries(),
    // Only consult the visitor once we actually know what this institute wants.
    // On a route that never resolved domain routing the mode reads as the
    // INSTITUTE_FIRST default and the country list reads as empty — which would
    // send every such form straight to the geo branch and quietly ignore a
    // portal that chose INSTITUTE_ONLY. Withholding detection there keeps those
    // routes on exactly the platform default they had before this feature.
    hasResolvedPhonePreferences() ? detectVisitorCountry() : null,
  );

/**
 * Read a portal's routing record WITHOUT touching the per-host caches that
 * `resolveDomainRouting` maintains. For pages that need to describe a brand
 * other than the one the browser is on (the privacy policy with `?app=`), where
 * caching the other brand's root-catalogue tag or phone preferences would
 * corrupt the current host's session.
 */
export const peekDomainRouting = async (
  domain: string,
  subdomain: string
): Promise<DomainRoutingResponse | null> => {
  try {
    const response = await authenticatedAxiosInstance.get<DomainRoutingResponse>(
      `${BASE_URL}/admin-core-service/public/domain-routing/v1/resolve`,
      { params: { domain, subdomain }, timeout: 10000 }
    );
    return response.data;
  } catch {
    return null;
  }
};

export const resolveDomainRouting = async (
  domain: string,
  subdomain: string
): Promise<DomainRoutingResponse | null> => {

  try {
    // Resolving domain routing for: ${domain}:${subdomain}

    const response = await authenticatedAxiosInstance.get<DomainRoutingResponse>(
      `${BASE_URL}/admin-core-service/public/domain-routing/v1/resolve`,
      {
        params: { domain, subdomain },
        timeout: 10000, // 10 second timeout
      }
    );

    const data = response.data;

    // Cache the phone-field preferences on EVERY resolve, not just the ones that
    // go through use-domain-routing. Public routes resolve directly through this
    // function (the product page, for one) and render phone fields; without this
    // their caches stay empty, `getCachedPhoneCountryGeoMode()` reads the
    // INSTITUTE_FIRST default, and an institute that deliberately chose
    // INSTITUTE_ONLY still gets geo-detection on those pages. Writing here makes
    // the preference follow the resolve, which is the thing that actually knows
    // which institute this page belongs to.
    setCachedPreferredCountries(data.commaSeparatedPreferredCountry ?? null);
    setCachedPhoneCountryGeoMode(data.phoneCountryGeoMode ?? null);
    // Same reasoning: the root-mount flag must follow the resolve, whichever
    // caller made it, or a cold load of "/" cannot know to render the site.
    setCachedRootCatalogueTag(data.rootCatalogueTag ?? null);

    // Successfully resolved domain routing
    return data;
  } catch (error: unknown) {
    // Type guard for axios error
    const isAxiosError = (
      err: unknown
    ): err is { response?: { status: number }; message: string } => {
      return typeof err === "object" && err !== null && "response" in err;
    };

    if (isAxiosError(error) && error.response?.status === 404) {
      // No institute found for domain/subdomain: ${domain}:${subdomain}
      return null;
    }

    console.error("[Domain Routing] API error:", error);
    const errorMessage = isAxiosError(error) ? error.message : "Unknown error";
    throw new Error(`Domain routing API error: ${errorMessage}`);
  }
};

// Helper function to get domain and subdomain from current location
export const getCurrentDomainInfo = async () => {
  // Use the platform-aware domain resolution
  return await getDomainAndSubdomain();
};

/**
 * Theme code -> primary-500 hex. Returns null for an unknown code so callers can
 * fall back rather than paint something arbitrary.
 */
const resolveThemeHex = (code?: string | null): string | null => {
  if (!code) return null;
  if (code.startsWith("#")) return code;
  const theme = (
    themeData.themes as ReadonlyArray<{
      code: string;
      colors?: { primary?: Record<string, string> };
    }>
  ).find((t) => t.code === code);
  return theme?.colors?.primary?.["500"] ?? null;
};

const normalizeBranding = (
  branding?: Partial<CachedInstituteBranding> | null
): CachedInstituteBranding => ({
  instituteId: branding?.instituteId ?? null,
  instituteName: branding?.instituteName ?? null,
  instituteLogoFileId: branding?.instituteLogoFileId ?? null,
  instituteLogoUrl: branding?.instituteLogoUrl ?? null,
  instituteThemeCode: branding?.instituteThemeCode ?? null,
  instituteThemeHex:
    branding?.instituteThemeHex ?? resolveThemeHex(branding?.instituteThemeCode),
  homeIconClickRoute: branding?.homeIconClickRoute ?? null,
  hideInstituteName:
    typeof branding?.hideInstituteName === "boolean"
      ? branding.hideInstituteName
      : null,
  logoWidthPx:
    typeof branding?.logoWidthPx === "number" ? branding.logoWidthPx : null,
  logoHeightPx:
    typeof branding?.logoHeightPx === "number" ? branding.logoHeightPx : null,
  stackNameBelowLogo:
    typeof branding?.stackNameBelowLogo === "boolean"
      ? branding.stackNameBelowLogo
      : null,
});

const readBrandingFromStorage = (): CachedInstituteBranding | null => {
  if (!canUseLocalStorage()) {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(BRANDING_CACHE_KEY);
    if (!stored) {
      return null;
    }

    return normalizeBranding(JSON.parse(stored));
  } catch (error) {
    console.warn("[Domain Routing] Failed to parse branding cache:", error);
    window.localStorage.removeItem(BRANDING_CACHE_KEY);
    return null;
  }
};

const deriveBrandingFromInstituteDetails = (): CachedInstituteBranding | null => {
  if (!canUseLocalStorage()) {
    return null;
  }

  try {
    const stored = window.localStorage.getItem("InstituteDetails");
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    return normalizeBranding({
      instituteId: parsed?.id ?? parsed?.instituteId ?? null,
      instituteName: parsed?.institute_name ?? parsed?.instituteName ?? null,
      instituteLogoFileId:
        parsed?.institute_logo_file_id ?? parsed?.instituteLogoFileId ?? null,
      instituteLogoUrl: parsed?.instituteLogoUrl ?? null,
      instituteThemeCode:
        parsed?.institute_theme_code ?? parsed?.instituteThemeCode ?? null,
      homeIconClickRoute:
        parsed?.home_icon_click_route ?? parsed?.homeIconClickRoute ?? null,
      hideInstituteName:
        typeof parsed?.hideInstituteName === "boolean"
          ? parsed.hideInstituteName
          : typeof parsed?.hide_institute_name === "boolean"
            ? parsed.hide_institute_name
            : null,
      logoWidthPx:
        typeof parsed?.logoWidthPx === "number"
          ? parsed.logoWidthPx
          : typeof parsed?.logo_width_px === "number"
            ? parsed.logo_width_px
            : null,
      logoHeightPx:
        typeof parsed?.logoHeightPx === "number"
          ? parsed.logoHeightPx
          : typeof parsed?.logo_height_px === "number"
            ? parsed.logo_height_px
            : null,
      stackNameBelowLogo:
        typeof parsed?.stackNameBelowLogo === "boolean"
          ? parsed.stackNameBelowLogo
          : typeof parsed?.stack_name_below_logo === "boolean"
            ? parsed.stack_name_below_logo
            : null,
    });
  } catch (error) {
    console.warn(
      "[Domain Routing] Failed to derive branding from InstituteDetails:",
      error
    );
    return null;
  }
};

export const getCachedInstituteBranding = (): CachedInstituteBranding | null => {
  if (cachedBrandingMemory) {
    return cachedBrandingMemory;
  }

  const stored = readBrandingFromStorage();
  if (stored) {
    cachedBrandingMemory = stored;
    return stored;
  }

  const derived = deriveBrandingFromInstituteDetails();
  if (derived) {
    setCachedInstituteBranding(derived);
    return derived;
  }

  return null;
};

export const setCachedInstituteBranding = (
  branding: Partial<CachedInstituteBranding> | null
) => {
  if (!branding) {
    cachedBrandingMemory = null;
  } else {
    cachedBrandingMemory = normalizeBranding(branding);
  }

  if (!canUseLocalStorage()) {
    return;
  }

  try {
    if (!branding) {
      window.localStorage.removeItem(BRANDING_CACHE_KEY);
      return;
    }

    window.localStorage.setItem(
      BRANDING_CACHE_KEY,
      JSON.stringify(cachedBrandingMemory)
    );
  } catch (error) {
    console.warn("[Domain Routing] Failed to persist branding cache:", error);
  }
};

export const updateCachedInstituteBranding = (
  partialBranding: Partial<CachedInstituteBranding>
) => {
  const existing = getCachedInstituteBranding();
  const merged = normalizeBranding({ ...existing, ...partialBranding });
  setCachedInstituteBranding(merged);
};

export const getPublicUrl = async (
  fileId: string | undefined | null
): Promise<string> => {
  if (!fileId) {
    return "";
  }

  try {
    return await getPublicUrlWithoutLogin(fileId);
  } catch (error) {
    console.error("[Domain Routing] Failed to resolve public URL:", error);
    return "";
  }
};

// Client-side cache now handled centrally by axios + in-memory cache
