import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
}));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/urls', () => ({ BASE_URL: 'https://api.test' }));

import {
    CATALOG_API_DOCS_URL,
    CATALOG_PRODUCT,
    addWebsite,
    buildCourseBaseUrlPayload,
    buildIssueCatalogKeyPayload,
    courseBaseUrlError,
    courseBaseUrlSource,
    fetchCatalogKeys,
    fetchCatalogSettings,
    fetchWebsites,
    issueCatalogKey,
    normalizeCatalogSettings,
    normalizeWebsite,
    normalizeWebsiteHost,
    normalizeWebsiteList,
    removeWebsite,
    resetCourseBaseUrl,
    saveCourseBaseUrl,
    verifyWebsite,
} from './catalog-api';

const KEYS_URL = 'https://api.test/admin-core-service/v1/api-keys';
const WEBSITES_URL = 'https://api.test/admin-core-service/v1/websites';
const SETTINGS_URL = 'https://api.test/admin-core-service/v1/catalog-api/settings';

const siteRow = {
    id: 'w1',
    host: 'learning.school.org',
    status: 'PENDING',
    dns_record: {
        type: 'TXT',
        name: '_vacademy-verification.learning.school.org',
        value: 'vacademy-site-verification=abc123',
    },
    verified_at: null,
    last_checked_at: '2026-10-15T08:00:00Z',
    last_error: 'No TXT record found yet.',
    created_at: '2026-10-15T07:00:00Z',
    revoked_reason: null,
};

beforeEach(() => {
    http.get.mockReset();
    http.post.mockReset();
    http.put.mockReset();
    http.delete.mockReset();
});

describe('normalizeWebsiteHost', () => {
    it('reduces a pasted URL, port, path or trailing dot to the bare host', () => {
        expect(normalizeWebsiteHost('https://WWW.School.org/courses?x=1')).toEqual({
            host: 'www.school.org',
            error: null,
        });
        expect(normalizeWebsiteHost(' school.org:3000 ').host).toBe('school.org');
        expect(normalizeWebsiteHost('learning.school.org.').host).toBe('learning.school.org');
        expect(normalizeWebsiteHost('http://a.b.school.co.in/x#y').host).toBe('a.b.school.co.in');
    });

    it('turns an international name into its ASCII form', () => {
        expect(normalizeWebsiteHost('bücher.example').host).toBe('xn--bcher-kva.example');
    });

    it('rejects what the server rejects', () => {
        expect(normalizeWebsiteHost('   ').error).toBe('host_required');
        expect(normalizeWebsiteHost('localhost:3000').error).toBe('host_localhost');
        expect(normalizeWebsiteHost('app.localhost').error).toBe('host_localhost');
        expect(normalizeWebsiteHost('192.168.1.10').error).toBe('host_ip');
        expect(normalizeWebsiteHost('http://[::1]:8080').error).toBe('host_ip');
        expect(normalizeWebsiteHost('intranet').error).toBe('host_single_label');
        expect(normalizeWebsiteHost('bad_label.example.com').error).toBe('host_invalid');
        expect(normalizeWebsiteHost('-dash.example.com').error).toBe('host_invalid');
        expect(normalizeWebsiteHost(`${'a'.repeat(60)}.`.repeat(5) + 'com').error).toBe(
            'host_too_long'
        );
    });
});

describe('normalizeWebsite / normalizeWebsiteList', () => {
    it('maps the snake_case view and keeps the DNS record', () => {
        expect(normalizeWebsite(siteRow)).toEqual({
            id: 'w1',
            host: 'learning.school.org',
            status: 'PENDING',
            dnsRecord: {
                type: 'TXT',
                name: '_vacademy-verification.learning.school.org',
                value: 'vacademy-site-verification=abc123',
            },
            verifiedAt: null,
            lastCheckedAt: '2026-10-15T08:00:00Z',
            lastError: 'No TXT record found yet.',
            createdAt: '2026-10-15T07:00:00Z',
            revokedReason: null,
        });
    });

    it('treats an unknown status as pending and drops rows without id or host', () => {
        expect(normalizeWebsite({ id: 'x', host: 'a.com', status: 'weird' })?.status).toBe(
            'PENDING'
        );
        expect(normalizeWebsite({ id: 'x', host: 'a.com', status: 'revoked' })?.status).toBe(
            'REVOKED'
        );
        expect(normalizeWebsiteList([siteRow, { id: 'no-host' }, null])).toHaveLength(1);
        expect(normalizeWebsiteList({ data: [siteRow] })).toHaveLength(1);
        expect(normalizeWebsiteList('nope')).toEqual([]);
    });
});

describe('website requests', () => {
    it('lists by institute', async () => {
        http.get.mockResolvedValue({ data: [siteRow] });
        const rows = await fetchWebsites('inst-1');
        expect(http.get).toHaveBeenCalledWith(WEBSITES_URL, { params: { instituteId: 'inst-1' } });
        expect(rows[0]?.host).toBe('learning.school.org');
    });

    it('adds the normalised host, and never calls the server for an unusable one', async () => {
        http.post.mockResolvedValue({ data: siteRow });
        await addWebsite('inst-1', 'https://Learning.School.org/store');
        expect(http.post).toHaveBeenCalledWith(
            WEBSITES_URL,
            { host: 'learning.school.org' },
            { params: { instituteId: 'inst-1' } }
        );
        await expect(addWebsite('inst-1', 'localhost')).rejects.toThrow('host_localhost');
        expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('verifies and removes by id', async () => {
        http.post.mockResolvedValue({ data: { ...siteRow, status: 'VERIFIED' } });
        const site = await verifyWebsite('inst-1', 'w/1');
        expect(http.post).toHaveBeenCalledWith(`${WEBSITES_URL}/w%2F1/verify`, null, {
            params: { instituteId: 'inst-1' },
        });
        expect(site.status).toBe('VERIFIED');

        http.delete.mockResolvedValue({ data: null });
        await removeWebsite('inst-1', 'w1');
        expect(http.delete).toHaveBeenCalledWith(`${WEBSITES_URL}/w1`, {
            params: { instituteId: 'inst-1' },
        });
    });
});

describe('publishable keys', () => {
    it('builds a catalog key body with a trimmed name and no expiry', () => {
        expect(buildIssueCatalogKeyPayload('inst-1', '  School site ')).toEqual({
            institute_id: 'inst-1',
            product: CATALOG_PRODUCT,
            name: 'School site',
            expires_at: null,
        });
        expect(CATALOG_PRODUCT).toBe('catalog');
        expect(() => buildIssueCatalogKeyPayload('i', '  ')).toThrow('name_required');
        expect(() => buildIssueCatalogKeyPayload('i', 'x'.repeat(121))).toThrow('name_too_long');
    });

    it('lists with product=catalog and issues through the shared endpoint', async () => {
        http.get.mockResolvedValue({
            data: [{ id: 'k1', name: 'Site', key_prefix: 'vak_pub_ab12', status: 'ACTIVE' }],
        });
        const keys = await fetchCatalogKeys('inst-1');
        expect(http.get).toHaveBeenCalledWith(KEYS_URL, {
            params: { instituteId: 'inst-1', product: 'catalog' },
        });
        expect(keys[0]?.prefix).toBe('vak_pub_ab12');

        http.post.mockResolvedValue({
            data: { id: 'k2', name: 'Site', key: 'vak_pub_secret', key_prefix: 'vak_pub_secr' },
        });
        const issued = await issueCatalogKey('inst-1', 'Site');
        expect(http.post).toHaveBeenCalledWith(
            KEYS_URL,
            { institute_id: 'inst-1', product: 'catalog', name: 'Site', expires_at: null },
            { params: { instituteId: 'inst-1' } }
        );
        expect(issued.key).toBe('vak_pub_secret');
    });
});

describe('course page address', () => {
    const bv = {
        site_tag: null,
        course_base_url: null,
        resolved: {
            site_tag: 'store',
            course_base_url: 'https://learning.brahmvarchas.org/store',
            source: 'domain_routing',
        },
    };

    it('reads the settings view', () => {
        expect(normalizeCatalogSettings(bv)).toEqual({
            siteTag: null,
            courseBaseUrl: null,
            resolved: {
                siteTag: 'store',
                courseBaseUrl: 'https://learning.brahmvarchas.org/store',
                source: 'domain_routing',
            },
        });
        expect(normalizeCatalogSettings(null).resolved.courseBaseUrl).toBeNull();
    });

    it('buckets the source for display', () => {
        const s = normalizeCatalogSettings(bv);
        expect(courseBaseUrlSource(s)).toBe('domain');
        expect(courseBaseUrlSource({ ...s, resolved: { ...s.resolved, source: 'SETTINGS' } })).toBe(
            'override'
        );
        expect(
            courseBaseUrlSource({
                ...s,
                resolved: { ...s.resolved, source: 'learner_portal_base_url' },
            })
        ).toBe('portal');
        expect(
            courseBaseUrlSource({ ...s, resolved: { ...s.resolved, courseBaseUrl: null } })
        ).toBe('none');
        expect(courseBaseUrlSource({ ...s, resolved: { ...s.resolved, source: 'zzz' } })).toBe(
            'other'
        );
    });

    it('accepts only an https address without query or fragment', () => {
        expect(courseBaseUrlError('')).toBe('url_required');
        expect(courseBaseUrlError('http://x.org/store')).toBe('url_not_https');
        expect(courseBaseUrlError('learning.x.org/store')).toBe('url_not_https');
        expect(courseBaseUrlError('https://x.org/store?a=1')).toBe('url_has_query');
        expect(courseBaseUrlError('https://x.org/store#top')).toBe('url_has_query');
        expect(courseBaseUrlError(`https://x.org/${'a'.repeat(500)}`)).toBe('url_too_long');
        expect(courseBaseUrlError(' https://x.org/store ')).toBeNull();
        expect(buildCourseBaseUrlPayload(' https://x.org/store/ ')).toEqual({
            course_base_url: 'https://x.org/store',
        });
    });

    it('GETs, PUTs an override (site_tag left out) and resets with ""', async () => {
        http.get.mockResolvedValue({ data: bv });
        await fetchCatalogSettings('inst-1');
        expect(http.get).toHaveBeenCalledWith(SETTINGS_URL, { params: { instituteId: 'inst-1' } });

        http.put.mockResolvedValue({ data: bv });
        await saveCourseBaseUrl('inst-1', 'https://x.org/store/');
        expect(http.put).toHaveBeenLastCalledWith(
            SETTINGS_URL,
            { course_base_url: 'https://x.org/store' },
            { params: { instituteId: 'inst-1' } }
        );
        await expect(saveCourseBaseUrl('inst-1', 'http://x.org')).rejects.toThrow('url_not_https');

        await resetCourseBaseUrl('inst-1');
        expect(http.put).toHaveBeenLastCalledWith(
            SETTINGS_URL,
            { course_base_url: '' },
            { params: { instituteId: 'inst-1' } }
        );
        expect(http.put).toHaveBeenCalledTimes(2);
    });

    it('keeps the docs link in one place', () => {
        expect(CATALOG_API_DOCS_URL).toBe('https://docs.vacademy.io/catalog');
    });
});
