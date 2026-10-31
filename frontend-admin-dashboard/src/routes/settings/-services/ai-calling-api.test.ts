import { describe, expect, it } from 'vitest';
import {
    AI_CALLING_PRODUCT,
    buildIssueAiCallingKeyPayload,
    canManageAgents,
    canManageCounsellors,
    canPlaceHumanCalls,
    normalizeWebhook,
    startCallCurlExample,
    webhookUrlError,
} from './ai-calling-api';

describe('buildIssueAiCallingKeyPayload', () => {
    const now = new Date(2026, 9, 13, 12, 0, 0);

    it('issues an ai_calling key with a trimmed name and no expiry', () => {
        expect(
            buildIssueAiCallingKeyPayload('inst-1', { name: '  Our CRM ', expiryDate: '' }, now)
        ).toEqual({
            institute_id: 'inst-1',
            product: AI_CALLING_PRODUCT,
            name: 'Our CRM',
            expires_at: null,
        });
    });

    it('expires at the end of the picked local day', () => {
        const body = buildIssueAiCallingKeyPayload(
            'i',
            { name: 'k', expiryDate: '2026-12-31' },
            now
        );
        expect(body.expires_at).toBe(new Date(2026, 11, 31, 23, 59, 59, 999).toISOString());
    });

    it('grants human-call scopes only when asked', () => {
        expect(
            buildIssueAiCallingKeyPayload('i', { name: 'k', expiryDate: '' }, now).scopes
        ).toBeUndefined();
        expect(
            buildIssueAiCallingKeyPayload('i', { name: 'k', expiryDate: '', humanCalls: true }, now)
                .scopes
        ).toEqual([
            'calls:read',
            'calls:write',
            'webhooks:manage',
            'human_calls:read',
            'human_calls:write',
        ]);
        expect(canPlaceHumanCalls({ scopes: ['calls:write'] })).toBe(false);
        expect(canPlaceHumanCalls({ scopes: ['calls:write', 'human_calls:write'] })).toBe(true);
    });

    it('grants the management scopes only when asked, each on its own', () => {
        expect(
            buildIssueAiCallingKeyPayload(
                'i',
                { name: 'k', expiryDate: '', manageCounsellors: true },
                now
            ).scopes
        ).toEqual(['calls:read', 'calls:write', 'webhooks:manage', 'counsellors:manage']);
        expect(
            buildIssueAiCallingKeyPayload(
                'i',
                { name: 'k', expiryDate: '', humanCalls: true, manageAgents: true },
                now
            ).scopes
        ).toEqual([
            'calls:read',
            'calls:write',
            'webhooks:manage',
            'human_calls:read',
            'human_calls:write',
            'agents:manage',
        ]);
        expect(canManageCounsellors({ scopes: ['human_calls:write'] })).toBe(false);
        expect(canManageCounsellors({ scopes: ['counsellors:manage'] })).toBe(true);
        expect(canManageAgents({ scopes: ['calls:read', 'agents:manage'] })).toBe(true);
        expect(canManageAgents({})).toBe(false);
    });

    it('rejects a missing name, a past date and a malformed date', () => {
        expect(() =>
            buildIssueAiCallingKeyPayload('i', { name: ' ', expiryDate: '' }, now)
        ).toThrow('name_required');
        expect(() =>
            buildIssueAiCallingKeyPayload('i', { name: 'k', expiryDate: '2026-10-01' }, now)
        ).toThrow('expiry_in_past');
        expect(() =>
            buildIssueAiCallingKeyPayload('i', { name: 'k', expiryDate: '31/12/2026' }, now)
        ).toThrow('expiry_invalid');
    });
});

describe('webhookUrlError', () => {
    it('needs a full https address', () => {
        expect(webhookUrlError('')).toBe('url_required');
        expect(webhookUrlError('http://crm.example.com/hook')).toBe('url_not_https');
        expect(webhookUrlError('crm.example.com/hook')).toBe('url_not_https');
        expect(webhookUrlError(' https://crm.example.com/hook ')).toBeNull();
    });
});

describe('normalizeWebhook', () => {
    it('reads the server view and keeps the secret only when present', () => {
        expect(
            normalizeWebhook({
                object: 'webhook',
                url: 'https://x.test/h',
                enabled: true,
                events: ['call.completed', 'call.not_connected', 7],
                secret_hint: 'whsec_…abcd',
                updated_at: '2026-10-13T10:00:00Z',
            })
        ).toEqual({
            url: 'https://x.test/h',
            enabled: true,
            events: ['call.completed', 'call.not_connected'],
            secret: null,
            secretHint: 'whsec_…abcd',
            updatedAt: '2026-10-13T10:00:00Z',
        });
        expect(normalizeWebhook({ url: 'https://x.test/h', secret: 'whsec_1' })?.secret).toBe(
            'whsec_1'
        );
        expect(normalizeWebhook(null)).toBeNull();
        expect(normalizeWebhook({ error: { code: 'not_found' } })).toBeNull();
    });
});

describe('startCallCurlExample', () => {
    it('targets the public calls endpoint with the key header', () => {
        const curl = startCallCurlExample('<your key>');
        expect(curl).toContain('https://api.telleo.ai/v1/calls');
        expect(curl).toContain('X-API-Key: <your key>');
    });
});
