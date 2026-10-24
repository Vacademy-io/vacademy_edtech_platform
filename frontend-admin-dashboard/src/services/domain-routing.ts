import axios from 'axios';
import {
    DOMAIN_ROUTING_RESOLVE,
    DOMAIN_ROUTING_RESOLVE_BY_INSTITUTE,
    GET_PUBLIC_URL_PUBLIC,
} from '@/constants/urls';
import { getMainDomain, getSubdomain } from '@/utils/subdomain';
import { detectVisitorCountry } from '@/utils/geo-country';

export type DomainResolveResponse = {
    instituteId: string | null;
    instituteName: string;
    instituteLogoFileId?: string;
    instituteThemeCode?: string;
    role?: string;
    redirect?: string;
    privacyPolicyUrl?: string;
    afterLoginRoute?: string;
    termsAndConditionUrl?: string;
    theme?: string;
    tabText?: string;
    allowSignup?: boolean;
    tabIconFileId?: string;
    fontFamily?: string;
    allowGoogleAuth?: boolean;
    allowGithubAuth?: boolean;
    allowEmailOtpAuth?: boolean;
    allowPhoneAuth?: boolean;
    allowUsernamePasswordAuth?: boolean;
    learnerPortalUrl?: string | null;
    instructorPortalUrl?: string | null;
    convertUsernamePasswordToLowercase?: boolean;
    // When this portal's domain maps to a specific sub-org (a white-label SUB-ORG
    // admin portal), this holds that sub-org's own institute id. The backend sets
    // it from `institute_domain_routing.sub_org_id` and additionally overlays the
    // sub-org's logo/name/theme. Login uses it to scope access to the sub-org:
    // only users mapped to this sub-org (or unrestricted parent admins) may log in
    // on this portal. Null/absent for parent or non-sub-org portals.
    subOrgId?: string | null;
    // Comma-separated ISO 3166-1 alpha-2 country codes (e.g. "in,us,gb,au").
    // Drives the default selection and ordering of country options in phone inputs.
    commaSeparatedPreferredCountry?: string | null;
    // How phone inputs pick their country code on this portal — one of
    // PHONE_COUNTRY_GEO_MODES. Absent/unrecognised behaves as INSTITUTE_FIRST.
    phoneCountryGeoMode?: string | null;
    // When true, the institute name is hidden alongside the logo on the login
    // page and in the sidebar. Default (undefined/false): name is shown.
    hideInstituteName?: boolean | null;
    // Optional pixel overrides for logo sizing. When set, take precedence over
    // the default responsive classes.
    logoWidthPx?: number | null;
    logoHeightPx?: number | null;
    // When true, the institute name is stacked below the logo instead of beside
    // it. Default (undefined/false): name sits to the right of the logo.
    stackNameBelowLogo?: boolean | null;
};

/**
 * Parses the institute's `commaSeparatedPreferredCountry` (from domain routing)
 * into a normalized lowercase array of ISO 3166-1 alpha-2 country codes.
 * Reads from the cached domain routing branding so callers don't need to refetch.
 */
export function getCachedPreferredCountries(): string[] {
    try {
        const branding = getCachedInstituteBranding();
        const raw = branding?.commaSeparatedPreferredCountry;
        if (!raw) return [];
        return raw
            .split(',')
            .map((code) => code.trim().toLowerCase())
            .filter((code) => code.length > 0);
    } catch {
        return [];
    }
}

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
export const DEFAULT_PREFERRED_COUNTRIES = ['in', 'us', 'gb', 'au', 'ae'];

/**
 * How a portal decides which country code a phone field starts on. Stored per
 * white-label routing row (`institute_domain_routing.phone_country_geo_mode`)
 * and surfaced through domain routing. Mirrors the backend `PhoneCountryGeoMode`.
 */
export const PHONE_COUNTRY_GEO_MODES = ['INSTITUTE_FIRST', 'GEO_FIRST', 'INSTITUTE_ONLY'] as const;

export type PhoneCountryGeoMode = (typeof PHONE_COUNTRY_GEO_MODES)[number];

export const DEFAULT_PHONE_COUNTRY_GEO_MODE: PhoneCountryGeoMode = 'INSTITUTE_FIRST';

/**
 * Reads the portal's configured mode from cached domain routing. Anything
 * missing or unrecognised is {@link DEFAULT_PHONE_COUNTRY_GEO_MODE} — this
 * setting is cosmetic and must never be able to break a form.
 */
export function getPhoneCountryGeoMode(): PhoneCountryGeoMode {
    try {
        const raw = getCachedInstituteBranding()?.phoneCountryGeoMode;
        const upper = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
        return PHONE_COUNTRY_GEO_MODES.includes(upper as PhoneCountryGeoMode)
            ? (upper as PhoneCountryGeoMode)
            : DEFAULT_PHONE_COUNTRY_GEO_MODE;
    } catch {
        return DEFAULT_PHONE_COUNTRY_GEO_MODE;
    }
}

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
 * The resolution chain itself, as a pure function of its three inputs.
 *
 * Kept separate from {@link getPreferredPhoneCountries} so White Label settings
 * can preview the outcome of a mode the institute has selected but not yet
 * saved — the preview and the real forms then cannot drift apart.
 *
 * @param mode       the portal's configured mode
 * @param configured the institute's preferred countries, in their chosen order
 * @param detected   the country the visitor is in, or null when unknown
 */
export function resolvePhoneCountries(
    mode: PhoneCountryGeoMode,
    configured: string[],
    detected: string | null
): ResolvedPhoneCountries {
    // INSTITUTE_ONLY never looks at the visitor, whatever was passed in.
    const visitor = mode === 'INSTITUTE_ONLY' ? null : detected;

    // Institute list first, then the platform default, so GEO_FIRST still shows
    // the institute's chosen countries immediately under the detected one.
    const base = configured.length > 0 ? configured : DEFAULT_PREFERRED_COUNTRIES;

    if (mode === 'GEO_FIRST' && visitor) {
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
            defaultCountry: configured[0] ?? 'in',
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
        defaultCountry: DEFAULT_PREFERRED_COUNTRIES[0] ?? 'in',
        preferredCountries: DEFAULT_PREFERRED_COUNTRIES,
        mode,
        detectedCountry: null,
    };
}

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
/**
 * Whether this device has ever resolved an institute's branding, and therefore
 * knows what that institute wants a phone field to do.
 *
 * "The institute configured no countries" and "we have not yet asked the
 * institute anything" both leave {@link getCachedPreferredCountries} empty, and
 * they call for opposite behaviour. Letting geo-detection fill the second
 * silence would override a preference — including an INSTITUTE_ONLY opt-out —
 * that was never read.
 */
export function hasResolvedPhonePreferences(): boolean {
    try {
        return getCachedInstituteBranding() !== null;
    } catch {
        return false;
    }
}

export function getPreferredPhoneCountries(): ResolvedPhoneCountries {
    const mode = getPhoneCountryGeoMode();
    return resolvePhoneCountries(
        mode,
        getCachedPreferredCountries(),
        // Only consult the visitor once we actually know what this institute
        // wants. Without branding, the mode reads as the INSTITUTE_FIRST default
        // and the country list reads as empty — which would send the form to the
        // geo branch and quietly ignore a portal that chose INSTITUTE_ONLY.
        hasResolvedPhonePreferences() ? detectVisitorCountry() : null
    );
}

export async function resolveInstituteForCurrentHost(): Promise<DomainResolveResponse | null> {
    try {
        const hostname = window.location.hostname;

        const isLocal =
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname.endsWith('.localhost');

        let domain: string = hostname;
        let subdomain: string = '*';

        if (isLocal) {
            // admin.localhost -> domain=localhost, subdomain=admin
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                domain = 'localhost';
                subdomain = '*';
            } else {
                const parts = hostname.split('.');
                subdomain = parts[0] || '*';
                domain = 'localhost';
            }
        } else {
            // Regular domains: derive main domain and subdomain
            domain = getMainDomain() || hostname;
            subdomain = getSubdomain() || '*';
        }

        // Add timeout to prevent indefinite hanging on slow/failing requests
        const { data } = await axios.get<DomainResolveResponse>(DOMAIN_ROUTING_RESOLVE, {
            params: { domain, subdomain },
            timeout: 5000, // 5 second timeout
        });
        return data;
    } catch (_error) {
        // Return null on any error (404, timeout, network failure, etc.)
        // The app will use default branding in this case
        return null;
    }
}

/**
 * Resolve institute branding/theme by a fixed institute id, rather than the
 * request host. Used by native flavors (e.g. Vacademy Admin) whose WebView has
 * no meaningful hostname but which are anchored to one institute.
 *
 * Returns null if the endpoint is unavailable (e.g. not yet deployed) or the
 * institute has no domain-routing config — callers fall back to default
 * branding while still treating the institute id as the selected institute.
 */
export async function resolveInstituteById(
    instituteId: string
): Promise<DomainResolveResponse | null> {
    if (!instituteId) return null;
    try {
        const { data } = await axios.get<DomainResolveResponse>(
            DOMAIN_ROUTING_RESOLVE_BY_INSTITUTE,
            {
                params: { instituteId },
                timeout: 5000,
            }
        );
        return data;
    } catch (_error) {
        return null;
    }
}

/**
 * Resolve institute branding by a FIXED domain + subdomain (not the request
 * host). Used by native flavors (e.g. Vacademy Admin → vacademy.io/admin-app)
 * which have no meaningful WebView hostname but map to a known
 * `institute_domain_routing` row. Uses the same deployed public endpoint as
 * host-based resolution.
 */
export async function resolveInstituteForDomain(
    domain: string,
    subdomain: string
): Promise<DomainResolveResponse | null> {
    if (!domain || !subdomain) return null;
    try {
        const { data } = await axios.get<DomainResolveResponse>(DOMAIN_ROUTING_RESOLVE, {
            params: { domain, subdomain },
            timeout: 5000,
        });
        return data;
    } catch (_error) {
        return null;
    }
}

export async function getPublicUrl(fileId?: string | null): Promise<string | null> {
    if (!fileId) return null;
    try {
        const response = await axios.get<string>(GET_PUBLIC_URL_PUBLIC, {
            params: { fileId, expiryDays: 1 },
            timeout: 5000, // 5 second timeout
        });
        return response.data || null;
    } catch (_error) {
        return null;
    }
}

export function cacheInstituteBranding(
    instituteId: string | null | undefined,
    payload: DomainResolveResponse & { instituteLogoUrl?: string; tabIconUrl?: string },
    options?: { setSelectedInstitute?: boolean }
): void {
    // Native flavors that brand by a FIXED institute (e.g. Vacademy Admin → ca3c…)
    // pass setSelectedInstitute:false so the app shows that institute's theme while
    // login still resolves the user's OWN institute. Web (host-based) keeps the
    // default behaviour where the resolved institute IS the working institute.
    const setSelected = options?.setSelectedInstitute !== false;
    try {
        if (instituteId) {
            localStorage.setItem(instituteId, JSON.stringify(payload));
            if (setSelected) {
                localStorage.setItem('selectedInstituteId', instituteId);
            }
        }
        // Always store as current domain branding for robust fallback (drives the
        // app's theme/title/favicon via index.html pre-paint + ThemeProvider).
        localStorage.setItem('current_domain_branding', JSON.stringify(payload));
    } catch (_err) {
        // ignore storage failures
    }
}

export function getCachedInstituteBranding(
    id?: string
): (DomainResolveResponse & { instituteLogoUrl?: string; tabIconUrl?: string }) | null {
    try {
        // 1. Try the specifically requested ID
        if (id) {
            const specific = localStorage.getItem(id);
            if (specific) return JSON.parse(specific);
        }

        // 2. Try the currently selected ID (handling empty string as valid key)
        const selectedId = localStorage.getItem('selectedInstituteId');
        if (selectedId !== null) {
            const selected = localStorage.getItem(selectedId);
            if (selected) return JSON.parse(selected);
        }

        // 3. Fallback to the dedicated current domain key
        const currentDomain = localStorage.getItem('current_domain_branding');
        if (currentDomain) return JSON.parse(currentDomain);

        return null;
    } catch {
        return null;
    }
}
