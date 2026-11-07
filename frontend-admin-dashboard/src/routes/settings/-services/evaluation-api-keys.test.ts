import { describe, expect, it } from 'vitest';
import {
    DEFAULT_EVALUATION_API_SCOPES,
    apiKeyCreatorLabel,
    apiKeyDisplayStatus,
    buildIssueKeyPayload,
    isProductNotEnabledError,
    apiKeyErrorMessage,
    normalizeApiKeyList,
    normalizeIssuedKey,
} from './evaluation-api-keys';

const axiosError = (status: number, data: unknown) => ({ response: { status, data } });

describe('normalizeApiKeyList', () => {
    it('reads the spec list (snake_case array) as enabled', () => {
        const out = normalizeApiKeyList([
            {
                id: 'k1',
                name: 'ERP',
                key_prefix: 'vak_eval_1a2b3c4',
                scopes: ['evaluation:read', 'evaluation:write'],
                status: 'ACTIVE',
                created_by: 'u1',
                created_at: '2026-10-01T10:00:00Z',
                last_used_at: null,
                expires_at: null,
                daily_copy_cap: 500,
            },
        ]);
        expect(out.enabled).toBe(true);
        expect(out.keys).toEqual([
            {
                id: 'k1',
                name: 'ERP',
                prefix: 'vak_eval_1a2b3c4',
                scopes: ['evaluation:read', 'evaluation:write'],
                status: 'ACTIVE',
                createdByName: null,
                createdById: 'u1',
                createdAt: '2026-10-01T10:00:00Z',
                lastUsedAt: null,
                expiresAt: null,
                dailyCopyCap: 500,
            },
        ]);
    });

    it('honours an explicit disabled flag on an object response', () => {
        expect(normalizeApiKeyList({ access_enabled: false, keys: [] }).enabled).toBe(false);
        expect(normalizeApiKeyList({ enabled: false }).enabled).toBe(false);
        expect(normalizeApiKeyList({ enabled: true, keys: [{ id: 'x' }] }).keys).toHaveLength(1);
    });

    it('tolerates camelCase, a display prefix field and junk rows', () => {
        const out = normalizeApiKeyList([
            { id: 'k2', keyName: 'Vendor', prefix: 'vak_eval_ff', status: 'revoked' },
            null,
            { name: 'no id' },
        ]);
        expect(out.keys).toHaveLength(1);
        expect(out.keys[0]).toMatchObject({
            name: 'Vendor',
            prefix: 'vak_eval_ff',
            status: 'REVOKED',
            scopes: [],
        });
    });

    it('treats an unexpected body as an empty, enabled list', () => {
        expect(normalizeApiKeyList(null)).toEqual({ enabled: true, keys: [] });
        expect(normalizeApiKeyList('oops')).toEqual({ enabled: true, keys: [] });
    });
});

describe('normalizeIssuedKey', () => {
    it('reads the one-time POST response', () => {
        const key = `vak_eval_${'a'.repeat(48)}`;
        expect(
            normalizeIssuedKey({
                id: 'k1',
                name: 'ERP',
                key,
                key_prefix: key.slice(0, 16),
                scopes: ['evaluation:read'],
                expires_at: null,
            })
        ).toEqual({
            id: 'k1',
            name: 'ERP',
            key,
            prefix: key.slice(0, 16),
            scopes: ['evaluation:read'],
            expiresAt: null,
        });
    });

    it('rejects a response without the key', () => {
        expect(normalizeIssuedKey({ id: 'k1', name: 'ERP' })).toBeNull();
        expect(normalizeIssuedKey(undefined)).toBeNull();
    });
});

describe('isProductNotEnabledError', () => {
    it('matches the machine code in either envelope', () => {
        expect(isProductNotEnabledError(axiosError(403, { code: 'product_not_enabled' }))).toBe(
            true
        );
        expect(
            isProductNotEnabledError(
                axiosError(403, { error: { code: 'evaluation_api_not_enabled', message: 'x' } })
            )
        ).toBe(true);
    });

    it('matches the shared ErrorInfo wording, whatever the status', () => {
        expect(
            isProductNotEnabledError(
                axiosError(510, {
                    ex: 'The Evaluation API is not enabled for this institute',
                    responseCode: '510 NOT_EXTENDED',
                })
            )
        ).toBe(true);
    });

    it('does not mistake a plain 403 (not an admin) or a network error for it', () => {
        expect(
            isProductNotEnabledError(
                axiosError(403, { ex: 'Only an institute admin can manage API keys' })
            )
        ).toBe(false);
        expect(isProductNotEnabledError(axiosError(403, ''))).toBe(false);
        expect(isProductNotEnabledError(new Error('Network Error'))).toBe(false);
        expect(isProductNotEnabledError(undefined)).toBe(false);
    });
});

describe('apiKeyErrorMessage', () => {
    it('prefers the server message, else null', () => {
        expect(apiKeyErrorMessage(axiosError(409, { ex: 'Max 50 active keys' }))).toBe(
            'Max 50 active keys'
        );
        expect(apiKeyErrorMessage(axiosError(400, { error: { message: 'Bad scope' } }))).toBe(
            'Bad scope'
        );
        expect(apiKeyErrorMessage(new Error('x'))).toBeNull();
    });
});

describe('buildIssueKeyPayload', () => {
    const now = new Date(2026, 9, 1, 12, 0, 0);
    const base = {
        name: '  School ERP  ',
        scopes: [...DEFAULT_EVALUATION_API_SCOPES],
        expiryDate: '',
        dailyCopyCap: '',
    };

    it('defaults to read + write and sends nulls for the optional fields', () => {
        expect(buildIssueKeyPayload('inst-1', base, now)).toEqual({
            institute_id: 'inst-1',
            name: 'School ERP',
            scopes: ['evaluation:read', 'evaluation:write'],
            expires_at: null,
            daily_copy_cap: null,
        });
    });

    it('orders scopes canonically and keeps the extra ones the admin ticked', () => {
        const out = buildIssueKeyPayload(
            'inst-1',
            { ...base, scopes: ['evaluation:finalize', 'evaluation:read', 'evaluation:review'] },
            now
        );
        expect(out.scopes).toEqual(['evaluation:read', 'evaluation:review', 'evaluation:finalize']);
    });

    it('sends the end of the picked local day as the expiry', () => {
        const out = buildIssueKeyPayload('inst-1', { ...base, expiryDate: '2026-12-31' }, now);
        expect(out.expires_at).toBe(new Date(2026, 11, 31, 23, 59, 59, 999).toISOString());
    });

    it('accepts today (ends tonight) but refuses a past date', () => {
        expect(
            buildIssueKeyPayload('inst-1', { ...base, expiryDate: '2026-10-01' }, now).expires_at
        ).not.toBeNull();
        expect(() =>
            buildIssueKeyPayload('inst-1', { ...base, expiryDate: '2026-09-30' }, now)
        ).toThrow('expiry_in_past');
        expect(() =>
            buildIssueKeyPayload('inst-1', { ...base, expiryDate: '31/12/2026' }, now)
        ).toThrow('expiry_invalid');
    });

    it('takes a positive whole daily cap only', () => {
        expect(
            buildIssueKeyPayload('inst-1', { ...base, dailyCopyCap: '250' }, now).daily_copy_cap
        ).toBe(250);
        for (const bad of ['0', '-5', '2.5', 'abc']) {
            expect(() =>
                buildIssueKeyPayload('inst-1', { ...base, dailyCopyCap: bad }, now)
            ).toThrow('cap_invalid');
        }
    });

    it('requires a name (max 120) and at least one known scope', () => {
        expect(() => buildIssueKeyPayload('inst-1', { ...base, name: '   ' }, now)).toThrow(
            'name_required'
        );
        expect(() =>
            buildIssueKeyPayload('inst-1', { ...base, name: 'x'.repeat(121) }, now)
        ).toThrow('name_too_long');
        expect(() => buildIssueKeyPayload('inst-1', { ...base, scopes: [] }, now)).toThrow(
            'scopes_invalid'
        );
        expect(() =>
            buildIssueKeyPayload('inst-1', { ...base, scopes: ['webhooks:manage'] }, now)
        ).toThrow('scopes_invalid');
    });
});

describe('apiKeyDisplayStatus', () => {
    const now = new Date('2026-10-01T12:00:00Z');

    it('reads an ACTIVE key whose expiry has passed as EXPIRED', () => {
        expect(
            apiKeyDisplayStatus({ status: 'ACTIVE', expiresAt: '2026-10-01T11:59:59Z' }, now)
        ).toBe('EXPIRED');
        expect(
            apiKeyDisplayStatus({ status: 'ACTIVE', expiresAt: '2026-10-01T12:00:00Z' }, now)
        ).toBe('EXPIRED');
    });

    it('keeps a future or missing expiry ACTIVE and a revoked key REVOKED', () => {
        expect(
            apiKeyDisplayStatus({ status: 'ACTIVE', expiresAt: '2026-10-02T00:00:00Z' }, now)
        ).toBe('ACTIVE');
        expect(apiKeyDisplayStatus({ status: 'ACTIVE', expiresAt: null }, now)).toBe('ACTIVE');
        expect(apiKeyDisplayStatus({ status: 'ACTIVE', expiresAt: 'not a date' }, now)).toBe(
            'ACTIVE'
        );
        expect(apiKeyDisplayStatus({ status: 'REVOKED', expiresAt: null }, now)).toBe('REVOKED');
        expect(apiKeyDisplayStatus({ status: 'EXPIRED', expiresAt: null }, now)).toBe('EXPIRED');
    });
});

describe('apiKeyCreatorLabel', () => {
    const uuid = '0f6c2a9e-1b2c-4d5e-8f90-123456789abc';

    it('prefers a resolved name', () => {
        expect(apiKeyCreatorLabel({ createdByName: 'Asha', createdById: uuid }, uuid, 'You')).toBe(
            'Asha'
        );
    });

    it('shows "You" for the current admin and a short id for anyone else', () => {
        expect(apiKeyCreatorLabel({ createdByName: null, createdById: uuid }, uuid, 'You')).toBe(
            'You'
        );
        expect(
            apiKeyCreatorLabel({ createdByName: null, createdById: uuid }, 'someone', 'You')
        ).toBe('0f6c2a9e…');
        expect(apiKeyCreatorLabel({ createdByName: null, createdById: 'u-1' }, null, 'You')).toBe(
            'u-1'
        );
        expect(apiKeyCreatorLabel({ createdByName: null, createdById: null }, uuid, 'You')).toBe(
            null
        );
    });
});
