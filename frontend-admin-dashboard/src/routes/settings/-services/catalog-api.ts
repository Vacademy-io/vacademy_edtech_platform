import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import {
    EVALUATION_API_KEYS_URL,
    MAX_API_KEY_NAME_LENGTH,
    normalizeApiKeyList,
    normalizeIssuedKey,
    type EvaluationApiKey,
    type IssuedEvaluationApiKey,
} from './evaluation-api-keys';

/**
 * Catalogue API v1: an institute's own website lists its published courses and sends
 * enquiries, using a publishable key (vak_pub_…) that only works from the institute's
 * verified websites (and localhost). Spec: catalog-api-spec.md §1, §3, §4.
 *
 * Keys live in the shared admin_core key table under product `catalog`, self-serve:
 *   POST   /admin-core-service/v1/api-keys {product: 'catalog', name, expires_at}
 *   GET    /admin-core-service/v1/api-keys?instituteId=&product=catalog
 *   DELETE /admin-core-service/v1/api-keys/{id}?instituteId=
 *
 * Approved websites (DNS TXT verification):
 *   GET    /admin-core-service/v1/websites?instituteId=              → list
 *   POST   /admin-core-service/v1/websites?instituteId=  {host}      → PENDING row + dns_record
 *   POST   /admin-core-service/v1/websites/{id}/verify?instituteId=  → VERIFIED, or PENDING + last_error
 *   DELETE /admin-core-service/v1/websites/{id}?instituteId=
 *
 * Where course pages live:
 *   GET/PUT /admin-core-service/v1/catalog-api/settings?instituteId=
 *     → {site_tag, course_base_url, resolved: {site_tag, course_base_url, source}}
 *     PUT: a null field keeps, "" clears.
 */
export const CATALOG_PRODUCT = 'catalog';
export const CATALOG_KEYS_QUERY_KEY = 'CATALOG_API_KEYS';
export const CATALOG_WEBSITES_QUERY_KEY = 'CATALOG_API_WEBSITES';
export const CATALOG_SETTINGS_QUERY_KEY = 'CATALOG_API_SETTINGS';

/** Public docs for the Catalogue API. The one place this address is written. */
export const CATALOG_API_DOCS_URL = 'https://docs.vacademy.io/catalog';

export const CATALOG_WEBSITES_URL = `${BASE_URL}/admin-core-service/v1/websites`;
export const CATALOG_SETTINGS_URL = `${BASE_URL}/admin-core-service/v1/catalog-api/settings`;

export const MAX_HOST_LENGTH = 253;
export const MAX_COURSE_BASE_URL_LENGTH = 500;

export type CatalogKey = EvaluationApiKey;
export type IssuedCatalogKey = IssuedEvaluationApiKey;

type RawRecord = Record<string, unknown>;

const asRecord = (value: unknown): RawRecord | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : null;

const str = (row: RawRecord, ...keys: string[]): string | null => {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return null;
};

// ── Publishable keys ─────────────────────────────────────────────────────────

/** Form → POST body. Publishable keys never expire on their own; revoke instead. */
export function buildIssueCatalogKeyPayload(
    instituteId: string,
    rawName: string
): { institute_id: string; product: string; name: string; expires_at: null } {
    const name = rawName.trim();
    if (!name) throw new Error('name_required');
    if (name.length > MAX_API_KEY_NAME_LENGTH) throw new Error('name_too_long');
    return { institute_id: instituteId, product: CATALOG_PRODUCT, name, expires_at: null };
}

export const fetchCatalogKeys = async (instituteId: string): Promise<CatalogKey[]> => {
    const response = await authenticatedAxiosInstance.get(EVALUATION_API_KEYS_URL, {
        params: { instituteId, product: CATALOG_PRODUCT },
    });
    return normalizeApiKeyList(response.data).keys;
};

export const issueCatalogKey = async (
    instituteId: string,
    name: string
): Promise<IssuedCatalogKey> => {
    const response = await authenticatedAxiosInstance.post(
        EVALUATION_API_KEYS_URL,
        buildIssueCatalogKeyPayload(instituteId, name),
        { params: { instituteId } }
    );
    const issued = normalizeIssuedKey(response.data);
    if (!issued) throw new Error('issue_response_invalid');
    return issued;
};

// ── Websites ─────────────────────────────────────────────────────────────────

export type WebsiteStatus = 'PENDING' | 'VERIFIED' | 'REVOKED';

export interface DnsRecord {
    type: string;
    name: string;
    value: string;
}

export interface CatalogWebsite {
    id: string;
    host: string;
    status: WebsiteStatus;
    dnsRecord: DnsRecord | null;
    verifiedAt: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
    createdAt: string | null;
    revokedReason: string | null;
}

export type HostError =
    | 'host_required'
    | 'host_invalid'
    | 'host_ip'
    | 'host_localhost'
    | 'host_single_label'
    | 'host_too_long';

export type HostResult = { host: string; error: null } | { host: null; error: HostError };

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * What the server will store for what the admin typed (WebsiteHosts.normalize, spec §3):
 * a pasted URL, a port or a path is fine; the result is the lower-case ASCII host. The
 * server re-checks, so this only exists to show "we'll add …" and catch obvious mistakes.
 */
export function normalizeWebsiteHost(raw: string): HostResult {
    const input = raw.trim();
    if (!input) return { host: null, error: 'host_required' };
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
    let hostname: string;
    try {
        hostname = new URL(withScheme).hostname;
    } catch {
        return { host: null, error: 'host_invalid' };
    }
    if (hostname.startsWith('[')) return { host: null, error: 'host_ip' };
    const host = hostname.toLowerCase().replace(/\.+$/, '');
    if (!host) return { host: null, error: 'host_invalid' };
    if (host === 'localhost' || host.endsWith('.localhost')) {
        return { host: null, error: 'host_localhost' };
    }
    if (/^[0-9.]+$/.test(host)) return { host: null, error: 'host_ip' };
    if (host.length > MAX_HOST_LENGTH) return { host: null, error: 'host_too_long' };
    const labels = host.split('.');
    if (labels.length < 2) return { host: null, error: 'host_single_label' };
    if (!labels.every((l) => LABEL.test(l))) return { host: null, error: 'host_invalid' };
    if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return { host: null, error: 'host_invalid' };
    return { host, error: null };
}

const toStatus = (value: string | null): WebsiteStatus => {
    const s = (value ?? '').toUpperCase();
    return s === 'VERIFIED' || s === 'REVOKED' ? s : 'PENDING';
};

export function normalizeWebsite(raw: unknown): CatalogWebsite | null {
    const row = asRecord(raw);
    if (!row) return null;
    const id = str(row, 'id');
    const host = str(row, 'host');
    if (!id || !host) return null;
    const dns = asRecord(row.dns_record ?? row.dnsRecord);
    const dnsName = dns ? str(dns, 'name') : null;
    const dnsValue = dns ? str(dns, 'value') : null;
    return {
        id,
        host,
        status: toStatus(str(row, 'status')),
        dnsRecord:
            dns && dnsName && dnsValue
                ? { type: str(dns, 'type') ?? 'TXT', name: dnsName, value: dnsValue }
                : null,
        verifiedAt: str(row, 'verified_at', 'verifiedAt'),
        lastCheckedAt: str(row, 'last_checked_at', 'lastCheckedAt'),
        lastError: str(row, 'last_error', 'lastError'),
        createdAt: str(row, 'created_at', 'createdAt'),
        revokedReason: str(row, 'revoked_reason', 'revokedReason'),
    };
}

/** A bare array (the spec) or a wrapper {data | websites | items}. */
export function normalizeWebsiteList(data: unknown): CatalogWebsite[] {
    const obj = asRecord(data);
    const rows = Array.isArray(data) ? data : obj?.data ?? obj?.websites ?? obj?.items;
    return Array.isArray(rows)
        ? rows.map(normalizeWebsite).filter((w): w is CatalogWebsite => w !== null)
        : [];
}

export const fetchWebsites = async (instituteId: string): Promise<CatalogWebsite[]> => {
    const response = await authenticatedAxiosInstance.get(CATALOG_WEBSITES_URL, {
        params: { instituteId },
    });
    return normalizeWebsiteList(response.data);
};

/** Sends the normalised host; throws the HostError code when it is not usable. */
export const addWebsite = async (instituteId: string, rawHost: string): Promise<CatalogWebsite> => {
    const result = normalizeWebsiteHost(rawHost);
    if (result.error) throw new Error(result.error);
    const response = await authenticatedAxiosInstance.post(
        CATALOG_WEBSITES_URL,
        { host: result.host },
        { params: { instituteId } }
    );
    const site = normalizeWebsite(response.data);
    if (!site) throw new Error('website_response_invalid');
    return site;
};

export const verifyWebsite = async (
    instituteId: string,
    websiteId: string
): Promise<CatalogWebsite> => {
    const response = await authenticatedAxiosInstance.post(
        `${CATALOG_WEBSITES_URL}/${encodeURIComponent(websiteId)}/verify`,
        null,
        { params: { instituteId } }
    );
    const site = normalizeWebsite(response.data);
    if (!site) throw new Error('website_response_invalid');
    return site;
};

export const removeWebsite = async (instituteId: string, websiteId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(
        `${CATALOG_WEBSITES_URL}/${encodeURIComponent(websiteId)}`,
        { params: { instituteId } }
    );
};

// ── Course page address ──────────────────────────────────────────────────────

export type CourseBaseUrlSource = 'override' | 'domain' | 'portal' | 'none' | 'other';

export interface CatalogApiSettings {
    /** Saved override, or null when automatic. */
    siteTag: string | null;
    courseBaseUrl: string | null;
    resolved: {
        siteTag: string | null;
        courseBaseUrl: string | null;
        /** Raw server value; see courseBaseUrlSource for the display bucket. */
        source: string | null;
    };
}

export function normalizeCatalogSettings(data: unknown): CatalogApiSettings {
    const row = asRecord(data) ?? {};
    const resolved = asRecord(row.resolved) ?? {};
    return {
        siteTag: str(row, 'site_tag', 'siteTag'),
        courseBaseUrl: str(row, 'course_base_url', 'courseBaseUrl'),
        resolved: {
            siteTag: str(resolved, 'site_tag', 'siteTag'),
            courseBaseUrl: str(resolved, 'course_base_url', 'courseBaseUrl'),
            source: str(resolved, 'source'),
        },
    };
}

/**
 * Display bucket for resolved.source. The spec does not fix the strings, so match on
 * words: a saved setting, the learner domain routing, or the institute's portal URL.
 */
export function courseBaseUrlSource(settings: CatalogApiSettings): CourseBaseUrlSource {
    if (!settings.resolved.courseBaseUrl) return 'none';
    const source = (settings.resolved.source ?? '').toLowerCase();
    if (!source) return settings.courseBaseUrl ? 'override' : 'other';
    if (/setting|override|custom|manual/.test(source)) return 'override';
    if (/domain|routing/.test(source)) return 'domain';
    if (/portal|institute|fallback/.test(source)) return 'portal';
    if (source === 'none') return 'none';
    return 'other';
}

export type CourseBaseUrlError =
    | 'url_required'
    | 'url_not_https'
    | 'url_has_query'
    | 'url_too_long';

/** The rules the server applies to an override (spec §4), checked before the request. */
export function courseBaseUrlError(raw: string): CourseBaseUrlError | null {
    const value = raw.trim();
    if (!value) return 'url_required';
    if (value.length > MAX_COURSE_BASE_URL_LENGTH) return 'url_too_long';
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return 'url_not_https';
    }
    if (url.protocol !== 'https:' || !url.hostname) return 'url_not_https';
    if (value.includes('?') || value.includes('#')) return 'url_has_query';
    return null;
}

/** Override → PUT body. Trailing slashes go: course links are `<base>/<course>`. */
export function buildCourseBaseUrlPayload(raw: string): { course_base_url: string } {
    const code = courseBaseUrlError(raw);
    if (code) throw new Error(code);
    return { course_base_url: raw.trim().replace(/\/+$/, '') };
}

export const fetchCatalogSettings = async (instituteId: string): Promise<CatalogApiSettings> => {
    const response = await authenticatedAxiosInstance.get(CATALOG_SETTINGS_URL, {
        params: { instituteId },
    });
    return normalizeCatalogSettings(response.data);
};

/** Saves an override; site_tag is left out so the server keeps it. */
export const saveCourseBaseUrl = async (
    instituteId: string,
    raw: string
): Promise<CatalogApiSettings> => {
    const response = await authenticatedAxiosInstance.put(
        CATALOG_SETTINGS_URL,
        buildCourseBaseUrlPayload(raw),
        { params: { instituteId } }
    );
    return normalizeCatalogSettings(response.data);
};

/** "Reset to automatic": "" clears the saved override. */
export const resetCourseBaseUrl = async (instituteId: string): Promise<CatalogApiSettings> => {
    const response = await authenticatedAxiosInstance.put(
        CATALOG_SETTINGS_URL,
        { course_base_url: '' },
        { params: { instituteId } }
    );
    return normalizeCatalogSettings(response.data);
};
