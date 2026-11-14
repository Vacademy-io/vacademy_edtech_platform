import { describe, expect, it } from 'vitest';
import type { EngagementItemDTO, EngagementPlanDTO, EngagementSlotDTO } from '../../-types/types';
import {
    changeItemType,
    dtoToForm,
    newSlotForm,
    type ComposerForm,
} from '../forms/composer-schema';
import {
    detachItem,
    detachSlot,
    formSnapshot,
    isComposerDirty,
    lockedChanges,
    mapServerMessage,
    planSaveSteps,
    slotSaveOrders,
    takeBaseline,
} from './use-composer-save';

let seq = 0;
function item(slotId: string, partial: Partial<EngagementItemDTO> = {}): EngagementItemDTO {
    seq += 1;
    return {
        id: `item-${seq}`,
        slotId,
        planId: 'plan-1',
        packageSessionId: 'ps-1',
        itemType: 'READING_HTML',
        title: `Task ${seq}`,
        version: 1,
        sortOrder: seq,
        isRequired: false,
        contentHtml: '<p>Read</p>',
        payloadJson: null,
        completionPoints: 10,
        correctPoints: 0,
        completedCount: 0,
        ...partial,
    };
}

const MCQ =
    '{"prompt":"<p>Which?</p>","format":"MCQ","options":[{"id":"a","text":"A"},{"id":"b","text":"B"}],"correctOptionId":"b","explanation":""}';

function slot(
    id: string,
    sortOrder: number,
    date: string,
    items: EngagementItemDTO[]
): EngagementSlotDTO {
    return {
        id,
        planId: 'plan-1',
        title: `Theme ${id}`,
        startDate: date,
        endDate: null,
        startTime: '06:00',
        endTime: '20:00',
        dowMask: null,
        revealTime: '20:30',
        notifyTime: '06:00',
        sortOrder,
        status: 'ACTIVE',
        items,
    };
}

/** The 3-day demo: 3, 9 and 2 tasks. */
function demo(): EngagementPlanDTO {
    seq = 0;
    return {
        id: 'plan-1',
        instituteId: 'inst-1',
        packageSessionId: 'ps-1',
        title: 'UI review demo',
        description: '',
        status: 'PUBLISHED',
        timezone: 'UTC',
        defaultMissPolicy: 'CATCH_UP_REDUCED',
        defaultCatchUpDays: 2,
        defaultCatchUpPercent: 50,
        createdByUserId: 'u-1',
        slots: [
            slot('slot-1', 0, '2026-09-24', [
                item('slot-1', { sortOrder: 0 }),
                item('slot-1', {
                    sortOrder: 1,
                    itemType: 'QUESTION_OF_DAY',
                    contentHtml: null,
                    payloadJson: MCQ,
                    completedCount: 3,
                }),
                item('slot-1', { sortOrder: 2 }),
            ]),
            slot(
                'slot-2',
                1,
                '2026-09-25',
                Array.from({ length: 9 }, (_, i) => item('slot-2', { sortOrder: i }))
            ),
            slot('slot-3', 2, '2026-09-26', [
                item('slot-3', { sortOrder: 0 }),
                item('slot-3', { sortOrder: 1 }),
            ]),
        ],
    };
}

function load(): { form: ComposerForm; baseline: ReturnType<typeof takeBaseline> } {
    const form = dtoToForm(demo());
    return { form, baseline: takeBaseline(form) };
}

describe('planSaveSteps', () => {
    it('loads every day of the demo', () => {
        const { form } = load();
        expect(form.slots.map((s) => s.items.length)).toEqual([3, 9, 2]);
    });

    it('sends nothing for an untouched plan', () => {
        const { form, baseline } = load();
        const steps = planSaveSteps(form, baseline);
        expect(steps).toEqual({ deleteSlotIds: [], upsertSlots: [], planUpdate: null });
        expect(isComposerDirty(form, baseline)).toBe(false);
    });

    it('editing day 2 saves day 2 only, with all of its tasks and ids', () => {
        const { form, baseline } = load();
        form.slots[1]!.title = 'New theme';
        const steps = planSaveSteps(form, baseline);
        expect(steps.deleteSlotIds).toEqual([]);
        expect(steps.planUpdate).toBeNull();
        expect(steps.upsertSlots).toHaveLength(1);
        const [step] = steps.upsertSlots;
        expect(step!.index).toBe(1);
        expect(step!.request.id).toBe('slot-2');
        expect(step!.request.title).toBe('New theme');
        expect(step!.request.items!.map((i) => i.id)).toEqual(
            form.slots[1]!.items.map((i) => i.id)
        );
    });

    it('an editor rewriting an empty body as <p></p> is not an edit', () => {
        const { form } = load();
        form.slots.push(newSlotForm({ startDate: '2026-09-27' }));
        const baseline = takeBaseline(form);
        const added = form.slots[3]!.items[0]!;
        expect(added.itemType).toBe('READING_HTML');
        if (added.itemType === 'READING_HTML') added.contentHtml = '<p></p>';
        expect(formSnapshot(form)).toBe(baseline.full);
        if (added.itemType === 'READING_HTML') added.contentHtml = '<p>Hello</p>';
        expect(formSnapshot(form)).not.toBe(baseline.full);
    });

    it('a removed day is deleted; the others are not re-sent', () => {
        const { form, baseline } = load();
        const [day1, , day3] = form.slots;
        form.slots = [day1!, day3!];
        const steps = planSaveSteps(form, baseline);
        expect(steps.deleteSlotIds).toEqual(['slot-2']);
        expect(steps.upsertSlots).toHaveLength(0);
    });

    it('never renumbers days: a legacy plan with every sortOrder 0 saves only the edited day', () => {
        const plan = demo();
        plan.slots!.forEach((slot) => (slot.sortOrder = 0));
        const form = dtoToForm(plan);
        const baseline = takeBaseline(form);
        form.slots[1]!.title = 'Edited';
        const steps = planSaveSteps(form, baseline);
        expect(steps.upsertSlots.map((step) => step.request.id)).toEqual(['slot-2']);
        expect(steps.upsertSlots[0]!.request.sortOrder).toBe(0);
    });

    it('a new day takes the next sortOrder after every stored one', () => {
        const { form } = load();
        form.slots.push(newSlotForm({ startDate: '2026-09-30' }));
        expect(slotSaveOrders(form.slots)).toEqual([0, 1, 2, 3]);
    });

    it('a new day is created and plan fields go in their own update, without slots', () => {
        const { form, baseline } = load();
        form.title = 'Renamed';
        form.slots.push(detachSlot(form.slots[2]!, { startDate: '2026-09-27', endDate: '' }));
        const steps = planSaveSteps(form, baseline);
        expect(steps.planUpdate).toMatchObject({ title: 'Renamed' });
        expect(steps.planUpdate).not.toHaveProperty('slots');
        expect(steps.upsertSlots).toHaveLength(1);
        const created = steps.upsertSlots[0]!.request;
        expect(created.id).toBeUndefined();
        expect(created.startDate).toBe('2026-09-27');
        expect(created.items!.every((i) => i.id === undefined)).toBe(true);
    });
});

describe('detach and locks', () => {
    it('detachItem drops the id and counts but keeps the content', () => {
        const { form } = load();
        const original = form.slots[0]!.items[1]!;
        const copy = detachItem(original);
        expect(copy.id).toBeUndefined();
        expect(copy.key).not.toBe(original.key);
        expect(copy.completedCount).toBeNull();
        expect(copy.itemType).toBe('QUESTION_OF_DAY');
    });

    it('flags an answered task whose type changed', () => {
        const { form } = load();
        expect(lockedChanges(form)).toEqual([]);
        form.slots[0]!.items[1] = changeItemType(form.slots[0]!.items[1]!, 'POLL');
        const locked = lockedChanges(form);
        expect(locked).toHaveLength(1);
        expect(locked[0]).toMatchObject({ dayIndex: 0, itemIndex: 1, answered: 3 });
    });
});

describe('mapServerMessage', () => {
    it('maps known messages to i18n keys', () => {
        expect(mapServerMessage('Card 3: back is longer than 500 characters')).toEqual({
            key: 'composer.serverErrors.card_backTooLong',
            values: { n: '3', max: 500 },
        });
        expect(
            mapServerMessage(
                "Learners have already completed this task, so its type can't change. Add a new task instead."
            )?.key
        ).toBe('composer.serverErrors.typeLocked');
        expect(mapServerMessage('The poll "Mood" needs at least two options.')).toEqual({
            key: 'composer.serverErrors.pollOptions',
            values: { title: 'Mood' },
        });
        expect(mapServerMessage('Something new')).toBeNull();
    });
});
