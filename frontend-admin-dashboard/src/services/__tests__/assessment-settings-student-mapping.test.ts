import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import { mergeWithDefaults } from '../assessment-settings';
import type { AssessmentSettingsData } from '@/types/assessment-settings';

const saved = (aiCopyCheck: Record<string, unknown>) =>
    ({
        aiCopyCheck: { commentPlacement: 'INSIDE', ...aiCopyCheck },
    }) as unknown as Partial<AssessmentSettingsData>;

describe('assessment settings: studentMapping survives the load', () => {
    it('keeps a saved CHECK_ONLY / MAP choice', () => {
        expect(
            mergeWithDefaults(saved({ studentMapping: 'CHECK_ONLY' })).aiCopyCheck?.studentMapping
        ).toBe('CHECK_ONLY');
        expect(
            mergeWithDefaults(saved({ studentMapping: 'MAP' })).aiCopyCheck?.studentMapping
        ).toBe('MAP');
    });

    it('drops ASK / unknown / missing (all read as ASK) and leaves the other fields as before', () => {
        const s = mergeWithDefaults(
            saved({ studentMapping: 'whatever', commentPlacement: 'OUTSIDE', instructions: 'x' })
        );
        expect(s.aiCopyCheck?.studentMapping).toBeUndefined();
        expect(s.aiCopyCheck?.commentPlacement).toBe('OUTSIDE');
        expect(s.aiCopyCheck?.instructions).toBe('x');
        expect(mergeWithDefaults(saved({})).aiCopyCheck).toEqual({ commentPlacement: 'INSIDE' });
    });
});
