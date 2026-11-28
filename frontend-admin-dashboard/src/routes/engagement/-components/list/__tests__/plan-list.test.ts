import { describe, expect, it } from 'vitest';
import {
    averageRate,
    completionRate,
    groupSlotsByPhase,
    isWindowClosed,
    learnersFor,
    wallClockInZone,
} from '../PlanDaySchedule';
import { lifecycleStatuses } from '../PlanListToolbar';
import {
    buildDuplicateRequest,
    defaultCopyStart,
    planEndDate,
    planStartDate,
} from '../../DuplicatePlanDialog';
import { lifecycleChip, lookAlikePlanIds, metaLine, todayLineFor } from '../../PlanCard';
import type {
    EngagementItemDTO,
    EngagementPlanDTO,
    EngagementSlotDTO,
} from '../../../-types/types';

function item(overrides: Partial<EngagementItemDTO> = {}): EngagementItemDTO {
    return {
        id: 'i1',
        slotId: 's1',
        planId: 'p1',
        packageSessionId: 'ps1',
        itemType: 'QUESTION_OF_DAY',
        title: 'Q',
        version: 3,
        sortOrder: 0,
        isRequired: true,
        payloadJson: '{"prompt":"?","options":[{"id":"a","text":"A"}],"correctOptionId":"a"}',
        completionPoints: 5,
        correctPoints: 5,
        hideResultUntilReveal: true,
        completedCount: 1,
        ...overrides,
    };
}

function slot(overrides: Partial<EngagementSlotDTO> = {}): EngagementSlotDTO {
    return {
        id: 's1',
        planId: 'p1',
        title: 'Theme',
        startDate: '2026-09-24',
        endDate: null,
        startTime: '06:00',
        endTime: '20:00',
        revealTime: '20:30',
        notifyTime: '06:05',
        sortOrder: 0,
        status: 'ACTIVE',
        items: [item()],
        ...overrides,
    };
}

function plan(overrides: Partial<EngagementPlanDTO> = {}): EngagementPlanDTO {
    return {
        id: 'p1',
        instituteId: 'inst',
        packageSessionId: 'ps1',
        title: 'Daily quiz',
        status: 'PUBLISHED',
        timezone: 'Asia/Kolkata',
        defaultMissPolicy: 'CATCH_UP_REDUCED',
        defaultCatchUpDays: 2,
        defaultCatchUpPercent: 50,
        createdByUserId: 'u1',
        ...overrides,
    };
}

const t = (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key;

describe('PlanDaySchedule helpers', () => {
    const slots = [
        slot({ id: 'past', startDate: '2026-09-24' }),
        slot({ id: 'today', startDate: '2026-09-25' }),
        slot({ id: 'later', startDate: '2026-09-27' }),
        slot({ id: 'soon', startDate: '2026-09-26' }),
        // Repeats Mon–Sun across today: counts as Today.
        slot({ id: 'range', startDate: '2026-09-20', endDate: '2026-09-30' }),
        // Repeats on Sat/Sun only (32 + 64); 25 Sep 2026 is a Friday, next run is ahead.
        slot({ id: 'weekend', startDate: '2026-09-20', endDate: '2026-09-30', dowMask: 96 }),
    ];

    it('groups days into past, today and upcoming in schedule order', () => {
        const g = groupSlotsByPhase(slots, '2026-09-25');
        expect(g.past.map((s) => s.id)).toEqual(['past']);
        expect(g.today.map((s) => s.id)).toEqual(['range', 'today']);
        expect(g.upcoming.map((s) => s.id)).toEqual(['weekend', 'soon', 'later']);
    });

    it('takes the most specific learner count and computes rates', () => {
        const p = plan({ learnerCount: 10 });
        expect(learnersFor(item({ learnerCount: 2 }), slot({ learnerCount: 5 }), p)).toBe(2);
        expect(learnersFor(item(), slot({ learnerCount: 5 }), p)).toBe(5);
        expect(learnersFor(item(), slot(), p)).toBe(10);
        expect(learnersFor(item(), slot(), plan())).toBeNull();
        expect(completionRate(1, 2)).toBe(0.5);
        expect(completionRate(3, 2)).toBe(1);
        expect(completionRate(1, 0)).toBeNull();
        expect(completionRate(1, null)).toBeNull();
    });

    it('averages completion over every task with a denominator', () => {
        const days = [
            slot({ items: [item({ completedCount: 2 }), item({ id: 'i2', completedCount: 0 })] }),
            slot({ id: 's2', items: [item({ id: 'i3', completedCount: 1 })] }),
        ];
        expect(averageRate(days, plan({ learnerCount: 2 }))).toBeCloseTo(3 / 6);
        expect(averageRate(days, plan())).toBeNull();
    });

    it('closes today only after its end time, in the plan zone', () => {
        const s = slot({ endTime: '20:00' });
        expect(isWindowClosed(s, 'PAST', '00:00')).toBe(true);
        expect(isWindowClosed(s, 'UPCOMING', '23:59')).toBe(false);
        expect(isWindowClosed(s, 'TODAY', '19:59')).toBe(false);
        expect(isWindowClosed(s, 'TODAY', '20:01')).toBe(true);
        // 14:45 UTC is 20:15 in India.
        expect(wallClockInZone('Asia/Kolkata', new Date('2026-09-25T14:45:00Z'))).toBe('20:15');
    });
});

describe('lifecycle filter', () => {
    it('maps segments to /plan/list statuses', () => {
        expect(lifecycleStatuses('CURRENT')).toEqual(['RUNNING', 'UPCOMING', 'DRAFT']);
        expect(lifecycleStatuses('ALL')).toBeUndefined();
        expect(lifecycleStatuses('ARCHIVED')).toEqual(['ARCHIVED']);
    });
});

describe('duplicate', () => {
    const source = plan({
        description: 'Warm-ups',
        slots: [
            slot({
                id: 's2',
                startDate: '2026-09-26',
                sortOrder: 1,
                items: [
                    item({ id: 'b', sortOrder: 1, title: 'Second' }),
                    item({ id: 'a', sortOrder: 0, title: 'First', missPolicy: 'EXPIRES' }),
                ],
            }),
            slot({
                id: 's1',
                startDate: '2026-09-24',
                endDate: '2026-09-25',
                dowMask: 127,
            }),
            // A one-day slot with a stray mask: the copy drops the mask.
            slot({ id: 's3', startDate: '2026-09-28', dowMask: 1 }),
        ],
    });

    it('finds the first and last day and a default start a week on, never in the past', () => {
        expect(planStartDate(source)).toBe('2026-09-24');
        expect(planEndDate(source)).toBe('2026-09-28');
        expect(defaultCopyStart(source, '2026-09-25')).toBe('2026-10-01');
        expect(defaultCopyStart(source, '2026-10-20')).toBe('2026-10-20');
        expect(defaultCopyStart(plan({ slots: [] }), '2026-10-20')).toBe('2026-10-20');
    });

    it('shifts every day, drops ids and saves as a draft for each batch', () => {
        const request = buildDuplicateRequest(source, {
            title: '  Daily quiz  ',
            packageSessionIds: ['ps2', 'ps3'],
            startDate: '2026-10-01',
        });
        expect(request.title).toBe('Daily quiz');
        expect(request.status).toBe('DRAFT');
        expect(request.packageSessionIds).toEqual(['ps2', 'ps3']);
        expect(request.packageSessionId).toBeUndefined();
        expect(request.description).toBe('Warm-ups');
        expect(request.defaultMissPolicy).toBe('CATCH_UP_REDUCED');
        const slots = request.slots!;
        expect(slots.map((s) => [s.startDate, s.endDate ?? null])).toEqual([
            ['2026-10-01', '2026-10-02'],
            ['2026-10-03', null],
            ['2026-10-05', null],
        ]);
        expect(slots[0]!.dowMask).toBe(127);
        expect(slots[2]!.dowMask).toBeUndefined();
        expect(slots.every((s) => !('id' in s))).toBe(true);
        const items = slots[1]!.items!;
        expect(items.map((i) => i.title)).toEqual(['First', 'Second']);
        expect(items.every((i) => !('id' in i))).toBe(true);
        expect(items[0]!.payloadJson).toContain('correctOptionId');
        expect(items[0]!.missPolicy).toBe('EXPIRES');
        expect(items[0]!.hideResultUntilReveal).toBe(true);
        expect(slots[1]!.revealTime).toBe('20:30');
        expect(slots[1]!.title).toBe('Theme');
    });

    it('keeps the dates when starting on the same day', () => {
        const request = buildDuplicateRequest(source, {
            title: 'x',
            packageSessionIds: ['ps1'],
            startDate: '2026-09-24',
        });
        expect(request.slots!.map((s) => s.startDate)).toEqual([
            '2026-09-24',
            '2026-09-26',
            '2026-09-28',
        ]);
    });
});

describe('plan card lines', () => {
    const running = plan({
        packageSessionLabel: 'Physio · Batch A',
        firstDate: '2026-09-24',
        lastDate: '2026-09-26',
        dayCount: 3,
        taskCount: 14,
        todayState: 'RUNNING',
        todayTaskCount: 11,
        learnerCount: 2,
        todayStartedLearners: 1,
    });

    it('reads batch · dates · days · tasks', () => {
        const line = metaLine(running, { hideBatch: false, t, lang: 'en' });
        expect(line.startsWith('Physio · Batch A · ')).toBe(true);
        expect(line).toContain('card.days:{"count":3}');
        expect(line).toContain('card.tasks:{"count":14}');
        expect(metaLine(running, { hideBatch: true, t, lang: 'en' })).not.toContain('Physio');
        // An older server sends no summary: nothing to show, not "undefined".
        expect(metaLine(plan(), { hideBatch: false, t, lang: 'en' })).toBe('');
    });

    it('reads today and learners started while running', () => {
        expect(todayLineFor(running, t, 'en')).toBe(
            'card.todayTasks:{"count":11} · card.learnersStarted:{"count":2,"started":"1 / 2"}'
        );
        expect(todayLineFor({ ...running, todayTaskCount: 0 }, t, 'en')).toBe('card.nothingToday');
        expect(todayLineFor(plan(), t, 'en')).toBeNull();
    });

    it('labels the lifecycle with dates, and falls back to the stored status', () => {
        expect(lifecycleChip(running, 'RUNNING', t, 'en')).toEqual({
            text: 'card.lifecycle.RUNNING',
            tone: 'SUCCESS',
        });
        // The day without a weekday, in the admin's language ("Sep 24" in en).
        expect(lifecycleChip(running, 'UPCOMING', t, 'en').text).toBe(
            'card.lifecycle.UPCOMING_on:{"date":"Sep 24"}'
        );
        expect(lifecycleChip(running, 'ENDED', t, 'en').text).toContain('Sep 26');
        expect(lifecycleChip(plan(), null, t, 'en')).toEqual({
            text: 'card.status.PUBLISHED',
            tone: 'SUCCESS',
        });
    });
});

describe('look-alike plans', () => {
    const quiz = (id: string, createdAt: string) =>
        plan({
            id,
            title: 'daily quiz',
            firstDate: '2026-09-23',
            lastDate: '2026-09-23',
            createdAt,
        });

    it('flags plans with the same title, batch and dates, and nothing else', () => {
        const a = quiz('a', '2026-09-22T05:12:00Z');
        const b = { ...quiz('b', '2026-09-22T06:40:00Z'), title: 'Daily Quiz ' };
        const c = { ...quiz('c', '2026-09-22T06:40:00Z'), packageSessionId: 'ps2' };
        const d = { ...quiz('d', '2026-09-22T06:40:00Z'), lastDate: '2026-09-24' };
        expect([...lookAlikePlanIds([a, b, c, d])].sort()).toEqual(['a', 'b']);
        expect(lookAlikePlanIds([a]).size).toBe(0);
    });

    it('adds the creation time to the meta line only when asked', () => {
        const a = quiz('a', '2026-09-22T05:12:00Z');
        expect(metaLine(a, { hideBatch: true, t, lang: 'en' })).not.toContain('card.created');
        const line = metaLine(a, { hideBatch: true, showCreated: true, t, lang: 'en' });
        // 05:12 UTC is 10:42 in the plan's zone (Asia/Kolkata).
        expect(line).toContain('card.created');
        expect(line).toContain('10:42');
    });
});
