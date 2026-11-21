import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COURSE_SETTINGS, type DripCondition } from '@/types/course-settings';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get, post } }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/constants/urls', () => ({ BASE_URL: '' }));

import { saveDripConditionChanges } from '@/services/course-settings';

const rule = (id: string, levelId: string, day = 1): DripCondition => ({
    id,
    level: 'subject',
    level_id: levelId,
    enabled: true,
    drip_condition: [
        {
            target: 'subject',
            behavior: 'lock',
            is_enabled: true,
            rules: [
                {
                    type: 'relative_date',
                    params: { unlock_on_day: day, anchor: 'enrollment', unlock_time: '00:00' },
                },
            ],
        },
    ],
});

const serverHas = (conditions: DripCondition[]) =>
    get.mockResolvedValue({
        data: {
            data: {
                ...DEFAULT_COURSE_SETTINGS,
                dripConditions: { ...DEFAULT_COURSE_SETTINGS.dripConditions, conditions },
            },
        },
    });

const savedConditions = (): DripCondition[] =>
    post.mock.calls[0]?.[1].setting_data.dripConditions.conditions;

describe('saveDripConditionChanges', () => {
    beforeEach(() => {
        get.mockReset();
        post.mockReset().mockResolvedValue({ data: {} });
    });

    it('keeps rules another tab saved after this page loaded', async () => {
        // This page loaded [a]; another tab has since added b.
        serverHas([rule('a', 's1'), rule('b', 's2')]);
        const before = [rule('a', 's1')];

        const merged = await saveDripConditionChanges(before, [...before, rule('c', 's3')]);

        expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'c']);
        expect(savedConditions().map((c) => c.id)).toEqual(['a', 'b', 'c']);
    });

    it('applies an edit and a removal without touching unrelated rules', async () => {
        serverHas([rule('a', 's1'), rule('b', 's2'), rule('x', 's9')]);
        const before = [rule('a', 's1'), rule('b', 's2')];

        await saveDripConditionChanges(before, [rule('a', 's1', 5)]);

        const saved = savedConditions();
        expect(saved.map((c) => c.id)).toEqual(['a', 'x']);
        expect(saved[0]?.drip_condition[0]?.rules[0]?.params).toMatchObject({ unlock_on_day: 5 });
    });

    it('keeps the server copy of a rule this page did not change', async () => {
        serverHas([rule('a', 's1', 7)]);
        const stale = [rule('a', 's1', 1)];

        await saveDripConditionChanges(stale, [...stale, rule('c', 's3')]);

        expect(savedConditions()[0]?.drip_condition[0]?.rules[0]?.params).toMatchObject({
            unlock_on_day: 7,
        });
    });

    it('does not save when the fresh read fails', async () => {
        get.mockRejectedValue(new Error('network'));

        await expect(saveDripConditionChanges([], [rule('a', 's1')])).rejects.toThrow();
        expect(post).not.toHaveBeenCalled();
    });

    it('takes every other field from base when one is given', async () => {
        serverHas([rule('b', 's2')]);
        const base = {
            ...DEFAULT_COURSE_SETTINGS,
            dripConditions: {
                ...DEFAULT_COURSE_SETTINGS.dripConditions,
                enabled: true,
                conditions: [],
            },
        };

        await saveDripConditionChanges([], [], base);

        const saved = post.mock.calls[0]?.[1].setting_data;
        expect(saved.dripConditions.enabled).toBe(true);
        expect(saved.dripConditions.conditions.map((c: DripCondition) => c.id)).toEqual(['b']);
    });
});
