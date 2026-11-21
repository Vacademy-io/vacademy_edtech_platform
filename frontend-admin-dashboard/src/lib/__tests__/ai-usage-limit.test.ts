import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: {} }));

import {
    parseAiUsageLimitBody,
    parseUsageWarningHeader,
    prettifyUseCase,
} from '@/lib/ai-usage-limit';
import {
    cleanDraft,
    normalizeEffective,
    normalizeOverview,
    normalizePreview,
    normalizeRoleName,
    normalizeUsage,
} from '@/routes/settings/-services/ai-limits-service';

describe('parseAiUsageLimitBody', () => {
    it('reads the top-level N3 body with numeric strings', () => {
        const b = parseAiUsageLimitBody(
            {
                error: 'AI_USAGE_LIMIT',
                use_case: 'tutor_chat',
                limit: '20',
                used: '20.4',
                unit: 'credits',
            },
            '120'
        );
        expect(b).toMatchObject({
            use_case: 'tutor_chat',
            limit: 20,
            used: 20.4,
            retry_after_seconds: 120,
        });
    });
    it('reads a JSON string and a detail wrapper', () => {
        expect(parseAiUsageLimitBody(JSON.stringify({ error: 'AI_USAGE_LIMIT' }))).not.toBeNull();
        expect(
            parseAiUsageLimitBody({ detail: { error: 'AI_USAGE_LIMIT', scope: 'ROLE' } })?.scope
        ).toBe('ROLE');
    });
    it('ignores anything else', () => {
        expect(parseAiUsageLimitBody({ error: 'RATE_LIMITED' })).toBeNull();
        expect(parseAiUsageLimitBody({ detail: 'Too many requests' })).toBeNull();
        expect(parseAiUsageLimitBody('not json')).toBeNull();
        expect(parseAiUsageLimitBody(null)).toBeNull();
    });
});

describe('parseUsageWarningHeader', () => {
    it('parses one or several warnings', () => {
        expect(parseUsageWarningHeader('tutor_chat;pct=85')).toEqual([
            { useCase: 'tutor_chat', pct: 85 },
        ]);
        expect(parseUsageWarningHeader('a;pct=80.6, b')).toEqual([
            { useCase: 'a', pct: 81 },
            { useCase: 'b', pct: null },
        ]);
    });
    it('returns nothing for a missing or empty header', () => {
        expect(parseUsageWarningHeader(undefined)).toEqual([]);
        expect(parseUsageWarningHeader('  ')).toEqual([]);
    });
    it('prettifies a use-case key', () => {
        expect(prettifyUseCase('lesson_video')).toBe('Lesson video');
    });
});

describe('limits service normalizers', () => {
    it('defaults to an OFF policy and drops inactive rows', () => {
        const o = normalizeOverview({
            rows: [
                {
                    id: '1',
                    subject_kind: 'ROLE_CLASS',
                    subject_value: 'LEARNER',
                    soft_limit: '5',
                    hard_limit: '10',
                    is_active: true,
                },
                { id: '2', is_active: false },
            ],
        });
        expect(o.policy.mode).toBe('OFF');
        expect(o.policy.tenant_may_enforce).toBe(false);
        expect(o.rows).toHaveLength(1);
        expect(o.rows[0]?.hard_limit).toBe(10);
        expect(o.enforce_globally_enabled).toBe(true);
    });
    it('accepts list or wrapper shapes', () => {
        expect(normalizeEffective([{ decision: 'BLOCK', used: '3' }])[0]).toMatchObject({
            decision: 'BLOCK',
            used: 3,
        });
        expect(normalizeEffective({ limits: [{ decision: 'OK' }] })).toHaveLength(1);
        expect(
            normalizeUsage({ items: [{ key: 'U:1|ALL', credits_used: '2.5' }] })[0]?.credits_used
        ).toBe(2.5);
        const p = normalizePreview({
            would_block: 3,
            by_user: [{ user_id: 'u1', name: 'Asha', would_block: 3 }],
        });
        expect(p.by_user[0]).toMatchObject({
            key: 'u1',
            label: 'Asha',
            would_block: 3,
            would_warn: 0,
        });
    });
    it('cleans a draft for the server', () => {
        const d = cleanDraft({
            subject_kind: 'INSTITUTE',
            subject_value: 'x',
            per_member: true,
            scope_kind: 'ALL',
            scope_value: 'tutor',
            period: 'DAY',
            metric: 'CREDITS',
            soft_limit: null,
            hard_limit: 100,
        });
        expect(d).toMatchObject({ subject_value: null, scope_value: null, per_member: true });
    });
    it('normalizes role names like the server', () => {
        expect(normalizeRoleName('content creator')).toBe('CONTENT_CREATOR');
        expect(normalizeRoleName('co-ordinator')).toBe('CO_ORDINATOR');
    });
});
