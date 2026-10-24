import { describe, expect, it } from 'vitest';
import {
    COMPOSER_ERRORS,
    changeItemType,
    composerSchema,
    dtoToForm,
    flattenFormErrors,
    formToRequest,
    isGradingRelevantChange,
    itemSchema,
    newComposerForm,
    newItemForm,
    rebaseSlots,
    relativeDate,
    relativeDayOf,
    RELATIVE_DAY_ONE,
    requestToForm,
    resolveSortOrders,
    slotSchema,
    type ComposerForm,
    type ItemForm,
    type SlotForm,
} from '../../-components/forms/composer-schema';
import { planLifecycle, todayInZone } from '../format';
import type {
    EngagementItemDTO,
    EngagementItemRequest,
    EngagementPlanDTO,
    EngagementSlotDTO,
} from '../../-types/types';

// ── The 3-day demo plan (3, 7 and 4 tasks), with every field a save must keep ──

let seq = 0;
function item(slotId: string, partial: Partial<EngagementItemDTO>): EngagementItemDTO {
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
        contentHtml: null,
        slideId: null,
        questionId: null,
        assessmentId: null,
        payloadJson: null,
        completionPoints: 10,
        correctPoints: 0,
        maxScore: null,
        hideResultUntilReveal: null,
        completedCount: 0,
        ...partial,
    };
}

const MCQ_PAYLOAD =
    '{"prompt":"<p>Which law?</p>","format":"MCQ","options":[{"id":"a","text":"First"},{"id":"b","text":"Second","imageId":"img-9"},{"id":"c","text":"Third"}],"correctOptionId":"b","explanation":"<p>F = ma</p>","difficulty":"medium"}';
const TEXT_PAYLOAD = '{"format":"TEXT","prompt":"Explain inertia","explanation":""}';
const UPLOAD_PAYLOAD = '{"format":"UPLOAD","prompt":"Upload your diagram"}';
const POLL_PAYLOAD =
    '{"format":"MCQ","prompt":"How confident are you?","options":[{"id":"a","text":"Very"},{"id":"b","text":"A bit"}]}';
const LEGACY_QOTD_PAYLOAD =
    '{"prompt":"Pick one","options":[{"id":"x","text":"Yes"},{"id":"y","text":"No"}],"correctOptionId":"x"}';
const SLIDE_PAYLOAD =
    '{"slideId":"slide-7","courseId":"c-1","subjectId":"s-1","moduleId":"m-1","chapterId":"ch-1","slideTitle":"Motion","sourceType":"VIDEO"}';
const DECK_PAYLOAD =
    '{"schema":"flashcards/v1","cards":[{"id":"c_aaaaaa","front":"Inertia","back":"Resistance to change in motion"},{"id":"c_bbbbbb","front":"2 < x > 1","back":"<b>kept</b>","hint":"Maths"}],"settings":{"shuffle":false}}';

function demoPlan(): EngagementPlanDTO {
    seq = 0;
    const day1: EngagementSlotDTO = {
        id: 'slot-1',
        planId: 'plan-1',
        title: 'Day 1 · Forces',
        startDate: '2026-09-24',
        endDate: null,
        startTime: '06:00',
        endTime: '20:00',
        dowMask: null,
        revealTime: '20:30',
        notifyTime: '06:00',
        sortOrder: 0,
        status: 'ACTIVE',
        items: [
            item('slot-1', {
                itemType: 'READING_HTML',
                contentHtml: '<p>Read me</p>',
                sortOrder: 0,
            }),
            item('slot-1', {
                itemType: 'QUESTION_OF_DAY',
                payloadJson: MCQ_PAYLOAD,
                correctPoints: 20,
                hideResultUntilReveal: true,
                isRequired: true,
                sortOrder: 2,
                completedCount: 1,
                questionId: 'q-42',
            }),
            item('slot-1', { itemType: 'POLL', payloadJson: POLL_PAYLOAD, sortOrder: 5 }),
        ],
    };
    const day2: EngagementSlotDTO = {
        id: 'slot-2',
        planId: 'plan-1',
        title: null,
        startDate: '2026-09-28',
        endDate: '2026-10-09',
        startTime: '07:15',
        endTime: '21:45',
        // Mon, Wed, Fri.
        dowMask: 21,
        revealTime: null,
        notifyTime: null,
        sortOrder: 1,
        status: 'ACTIVE',
        items: [
            item('slot-2', {
                itemType: 'VISUAL_NOTE',
                contentHtml: '<img src="x.png">',
                sortOrder: 0,
            }),
            item('slot-2', {
                itemType: 'QUESTION_OF_DAY',
                payloadJson: TEXT_PAYLOAD,
                sortOrder: 1,
            }),
            item('slot-2', {
                itemType: 'QUESTION_OF_DAY',
                payloadJson: UPLOAD_PAYLOAD,
                sortOrder: 2,
            }),
            item('slot-2', {
                itemType: 'GAME',
                contentHtml: '<html><body>game</body></html>',
                maxScore: 10,
                correctPoints: 5,
                sortOrder: 3,
            }),
            item('slot-2', {
                itemType: 'COURSE_SLIDE',
                slideId: 'slide-7',
                payloadJson: SLIDE_PAYLOAD,
                sortOrder: 4,
                missPolicy: 'CATCH_UP_REDUCED',
                catchUpDays: 3,
                catchUpPercent: 40,
            }),
            item('slot-2', {
                itemType: 'FLASHCARDS',
                payloadJson: DECK_PAYLOAD,
                correctPoints: 0,
                maxScore: 2,
                hideResultUntilReveal: false,
                sortOrder: 5,
            }),
            item('slot-2', {
                itemType: 'QUIZ',
                payloadJson: '{"questions":[1,2,3]}',
                assessmentId: 'assess-1',
                sortOrder: 6,
            }),
        ],
    };
    const day3: EngagementSlotDTO = {
        id: 'slot-3',
        planId: 'plan-1',
        title: 'Day 3 · Review',
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        startTime: '00:05',
        endTime: '23:50',
        dowMask: 0,
        revealTime: '23:55',
        notifyTime: '08:00',
        sortOrder: 7,
        status: 'ACTIVE',
        items: [
            item('slot-3', {
                itemType: 'QUESTION_OF_DAY',
                payloadJson: LEGACY_QOTD_PAYLOAD,
                sortOrder: 10,
            }),
            item('slot-3', {
                itemType: 'READING_HTML',
                contentHtml: '<p>Summary</p>',
                payloadJson: '{"source":"ai","imagePrompts":["a"]}',
                sortOrder: 11,
            }),
            item('slot-3', { itemType: 'POLL', payloadJson: POLL_PAYLOAD, sortOrder: 12 }),
            item('slot-3', {
                itemType: 'READING_HTML',
                contentHtml: '<p>Extra</p>',
                missPolicy: 'CATCH_UP_FULL',
                catchUpDays: 2,
                sortOrder: 13,
            }),
        ],
    };
    return {
        id: 'plan-1',
        instituteId: 'inst-1',
        packageSessionId: 'ps-1',
        title: 'Physics week',
        description: 'Revision before the test',
        subjectId: 'sub-1',
        status: 'PUBLISHED',
        timezone: 'Europe/London',
        defaultMissPolicy: 'CATCH_UP_REDUCED',
        defaultCatchUpDays: 2,
        defaultCatchUpPercent: 50,
        createdByUserId: 'u-1',
        createdAt: '2026-09-20T10:00:00Z',
        // Shuffled on purpose: the form orders days and tasks by sortOrder.
        slots: [day2, day1, day3],
    };
}

/** The request fields an item DTO also carries; each must survive a round trip. */
const ITEM_FIELDS: (keyof EngagementItemRequest & keyof EngagementItemDTO)[] = [
    'id',
    'itemType',
    'title',
    'sortOrder',
    'isRequired',
    'contentHtml',
    'slideId',
    'questionId',
    'assessmentId',
    'payloadJson',
    'completionPoints',
    'correctPoints',
    'maxScore',
    'missPolicy',
    'catchUpDays',
    'catchUpPercent',
];

/** null and undefined both mean "not set" on the wire. */
const wire = (value: unknown) => (value === null ? undefined : value);

describe('dtoToForm → formToRequest', () => {
    it('keeps every field of the 3-day demo plan', () => {
        const plan = demoPlan();
        const request = formToRequest(dtoToForm(plan));

        expect(request).toMatchObject({
            title: plan.title,
            description: plan.description,
            subjectId: plan.subjectId,
            status: plan.status,
            packageSessionId: plan.packageSessionId,
            defaultMissPolicy: plan.defaultMissPolicy,
            defaultCatchUpDays: plan.defaultCatchUpDays,
            defaultCatchUpPercent: plan.defaultCatchUpPercent,
        });
        expect(request.packageSessionIds).toBeUndefined();

        const slotsInOrder = [...plan.slots!].sort((a, b) => a.sortOrder - b.sortOrder);
        expect(request.slots?.map((s) => s.items?.length)).toEqual([3, 7, 4]);

        slotsInOrder.forEach((slot, s) => {
            const sent = request.slots![s]!;
            expect(sent.id).toBe(slot.id);
            expect(wire(sent.title)).toBe(wire(slot.title));
            expect(sent.startDate).toBe(slot.startDate);
            expect(wire(sent.endDate)).toBe(wire(slot.endDate));
            expect(sent.startTime).toBe(slot.startTime);
            expect(sent.endTime).toBe(slot.endTime);
            expect(sent.dowMask ?? 0).toBe(slot.dowMask ?? 0);
            expect(wire(sent.revealTime)).toBe(wire(slot.revealTime));
            expect(wire(sent.notifyTime)).toBe(wire(slot.notifyTime));
            expect(sent.sortOrder).toBe(slot.sortOrder);

            const itemsInOrder = [...slot.items].sort((a, b) => a.sortOrder - b.sortOrder);
            itemsInOrder.forEach((dto, i) => {
                const req = sent.items![i]!;
                for (const field of ITEM_FIELDS) {
                    expect({ field, value: wire(req[field]) }).toEqual({
                        field,
                        value: wire(dto[field]),
                    });
                }
                expect(Boolean(req.hideResultUntilReveal)).toBe(Boolean(dto.hideResultUntilReveal));
            });
        });
    });

    it('keeps an explicit weekday mask exactly', () => {
        const request = formToRequest(dtoToForm(demoPlan()));
        expect(request.slots?.[1]?.dowMask).toBe(21);
    });

    it('produces a form that passes the schema', () => {
        const result = composerSchema.safeParse(dtoToForm(demoPlan()));
        expect(result.success ? [] : result.error.issues).toEqual([]);
    });

    it('rebuilds an edited question on top of the stored payload', () => {
        const form = dtoToForm(demoPlan());
        const qotd = form.slots[0]!.items[1]!;
        if (qotd.itemType !== 'QUESTION_OF_DAY') throw new Error('fixture');
        qotd.question.options[0]!.text = 'First (fixed typo)';
        const sent = JSON.parse(formToRequest(form).slots![0]!.items![1]!.payloadJson!);
        expect(sent).toEqual({
            prompt: '<p>Which law?</p>',
            format: 'MCQ',
            options: [
                { id: 'a', text: 'First (fixed typo)' },
                { id: 'b', text: 'Second', imageId: 'img-9' },
                { id: 'c', text: 'Third' },
            ],
            correctOptionId: 'b',
            explanation: '<p>F = ma</p>',
            difficulty: 'medium',
        });
        expect(isGradingRelevantChange(qotd)).toBe(false);
        qotd.question.correctOptionId = 'c';
        expect(isGradingRelevantChange(qotd)).toBe(true);
    });

    it('treats a missing format as MCQ, so an untouched legacy question is not a key change', () => {
        const form = dtoToForm(demoPlan());
        const legacy = form.slots[2]!.items[0]!;
        expect(isGradingRelevantChange(legacy)).toBe(false);
        if (legacy.itemType !== 'QUESTION_OF_DAY') throw new Error('fixture');
        legacy.question.prompt = 'Pick one, please';
        expect(isGradingRelevantChange(legacy)).toBe(false);
    });

    it('sends the forced deck fields and the deck payload canonically once edited', () => {
        const form = dtoToForm(demoPlan());
        const deck = form.slots[1]!.items[5]!;
        if (deck.itemType !== 'FLASHCARDS') throw new Error('fixture');
        deck.flashcards.cards.push({ id: 'c_cccccc', front: 'Mass', back: 'Amount of matter' });
        const sent = formToRequest(form).slots![1]!.items![5]!;
        expect(sent.maxScore).toBe(3);
        expect(sent.correctPoints).toBe(0);
        expect(sent.hideResultUntilReveal).toBe(false);
        expect(JSON.parse(sent.payloadJson!).cards.map((c: { id: string }) => c.id)).toEqual([
            'c_aaaaaa',
            'c_bbbbbb',
            'c_cccccc',
        ]);
    });
});

describe('no-op saves', () => {
    it('sends an untouched title back exactly as stored, and a real edit trimmed', () => {
        const plan = demoPlan();
        const stored = plan.slots![1]!.items[0]!;
        stored.title = '  Warm-up  ';
        const form = dtoToForm(plan);
        expect(formToRequest(form).slots![0]!.items![0]!.title).toBe('  Warm-up  ');
        // The resolver hands the form over trimmed; still the stored bytes go back.
        form.slots[0]!.items[0]!.title = 'Warm-up';
        expect(formToRequest(form).slots![0]!.items![0]!.title).toBe('  Warm-up  ');
        form.slots[0]!.items[0]!.title = ' Warm-up two ';
        expect(formToRequest(form).slots![0]!.items![0]!.title).toBe('Warm-up two');
    });

    it('lets an edit clear the description, and leaves it out of a new plan', () => {
        const form = dtoToForm(demoPlan());
        form.description = '   ';
        expect(formToRequest(form).description).toBe('');
        const created = newComposerForm({ packageSessionIds: ['ps-1'] });
        expect(formToRequest(created)).not.toHaveProperty('description', '');
        expect(formToRequest(created).description).toBeUndefined();
    });
});

describe('planLifecycle', () => {
    const base = { status: 'PUBLISHED' as const, firstDate: '2026-09-24', lastDate: '2026-09-26' };
    it('prefers the server state, then the server today, then derives', () => {
        expect(planLifecycle({ ...base, todayState: 'ENDED' }, '2026-09-25')).toBe('ENDED');
        expect(planLifecycle({ ...base, today: '2026-09-27' })).toBe('ENDED');
        expect(planLifecycle({ ...base, today: '2026-09-23' })).toBe('UPCOMING');
        expect(planLifecycle(base, '2026-09-25')).toBe('RUNNING');
        expect(planLifecycle({ status: 'PUBLISHED' }, '2026-09-25')).toBeNull();
        expect(planLifecycle({ status: 'DRAFT' }, '2026-09-25')).toBe('DRAFT');
    });

    it('reads today on the given calendar, not the UTC one', () => {
        // 20:00 UTC on 24 Sep is already 25 Sep in Tokyo and still 24 Sep in New York.
        const now = new Date('2026-09-24T20:00:00Z');
        expect(todayInZone('Asia/Tokyo', now)).toBe('2026-09-25');
        expect(todayInZone('America/New_York', now)).toBe('2026-09-24');
    });
});

describe('resolveSortOrders', () => {
    it('keeps saved values that still ascend and renumbers only what moved', () => {
        expect(resolveSortOrders([{ sortOrder: 0 }, { sortOrder: 2 }, { sortOrder: 5 }])).toEqual([
            0, 2, 5,
        ]);
        expect(resolveSortOrders([{ sortOrder: 5 }, { sortOrder: 0 }, { sortOrder: 2 }])).toEqual([
            5, 6, 7,
        ]);
        expect(resolveSortOrders([{ sortOrder: 3 }, {}, { sortOrder: null }])).toEqual([3, 4, 5]);
    });
});

// ── Validation ──────────────────────────────────────────────────────────────

function slotErrors(slot: SlotForm): string[] {
    const result = slotSchema.safeParse(slot);
    return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
}

function itemErrors(entry: ItemForm): string[] {
    const result = itemSchema.safeParse(entry);
    return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
}

function validSlot(): SlotForm {
    const reading = newItemForm('READING_HTML', { title: 'Read' });
    if (reading.itemType === 'READING_HTML') reading.contentHtml = '<p>Hi</p>';
    return {
        key: 'd1',
        title: '',
        startDate: '2026-09-24',
        endDate: '',
        startTime: '06:00',
        endTime: '20:00',
        dowMask: 0,
        revealTime: '20:00',
        notifyTime: '',
        items: [reading],
    };
}

describe('slotSchema', () => {
    it('accepts a valid day', () => {
        expect(slotErrors(validSlot())).toEqual([]);
    });

    it('checks time order, reveal after open, date order and the weekday mask', () => {
        expect(slotErrors({ ...validSlot(), endTime: '05:00' })).toContain(
            `endTime:${COMPOSER_ERRORS.time}`
        );
        expect(slotErrors({ ...validSlot(), revealTime: '05:59' })).toContain(
            `revealTime:${COMPOSER_ERRORS.revealBeforeOpen}`
        );
        expect(slotErrors({ ...validSlot(), endDate: '2026-09-23' })).toContain(
            `endDate:${COMPOSER_ERRORS.dateOrder}`
        );
        // 24 Sep 2026 is a Thursday; a Monday-only mask never runs in a one-day slot.
        expect(slotErrors({ ...validSlot(), dowMask: 1 })).toContain(
            `dowMask:${COMPOSER_ERRORS.weekdays}`
        );
        expect(slotErrors({ ...validSlot(), dowMask: 8 })).toEqual([]);
        expect(slotErrors({ ...validSlot(), startTime: '6am' })).toContain(
            `startTime:${COMPOSER_ERRORS.timeFormat}`
        );
        expect(slotErrors({ ...validSlot(), items: [] })).toContain(
            `items:${COMPOSER_ERRORS.tasks}`
        );
    });
});

describe('itemSchema', () => {
    it('needs two options for a poll and a key among the options for an MCQ', () => {
        const poll = newItemForm('POLL', { title: 'Poll' });
        if (poll.itemType !== 'POLL') throw new Error('type');
        poll.question.options = [{ id: 'a', text: 'Only one' }];
        expect(itemErrors(poll)).toContain(`question.options:${COMPOSER_ERRORS.pollOptions}`);

        const mcq = newItemForm('QUESTION_OF_DAY', { title: 'Q' });
        if (mcq.itemType !== 'QUESTION_OF_DAY') throw new Error('type');
        mcq.question.options = [
            { id: 'a', text: 'One' },
            { id: 'b', text: 'Two' },
        ];
        mcq.question.correctOptionId = 'z';
        expect(itemErrors(mcq)).toContain(`question.correctOptionId:${COMPOSER_ERRORS.correct}`);
        mcq.question.format = 'TEXT';
        expect(itemErrors(mcq)).toEqual([]);
    });

    it('rejects empty content, negative points and a game without a max score', () => {
        const reading = newItemForm('READING_HTML', { title: 'R', completionPoints: -5 });
        expect(itemErrors(reading)).toEqual(
            expect.arrayContaining([
                `completionPoints:${COMPOSER_ERRORS.points}`,
                `contentHtml:${COMPOSER_ERRORS.contentRequired}`,
            ])
        );
        const game = newItemForm('GAME', { title: 'G' });
        if (game.itemType !== 'GAME') throw new Error('type');
        game.contentHtml = '<html></html>';
        game.maxScore = null;
        expect(itemErrors(game)).toContain(`maxScore:${COMPOSER_ERRORS.maxScore}`);
    });

    it('rejects an empty deck and a lesson with no slide', () => {
        expect(itemErrors(newItemForm('FLASHCARDS', { title: 'Deck' }))).toContain(
            'flashcards.cards:composer.errors.cardsMin'
        );
        expect(itemErrors(newItemForm('COURSE_SLIDE', { title: 'Lesson' }))).toContain(
            `slideId:${COMPOSER_ERRORS.content}`
        );
    });
});

describe('composerSchema', () => {
    it('needs a batch for a new plan and reports every problem, in form order', () => {
        const form: ComposerForm = newComposerForm({ startDate: '2026-09-24' });
        const result = composerSchema.safeParse(form);
        expect(result.success).toBe(false);
        const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toEqual(
            expect.arrayContaining([
                'title',
                'packageSessionIds',
                'slots.0.items.0.title',
                'slots.0.items.0.contentHtml',
            ])
        );
    });

    it('defaults a new plan to Draft', () => {
        expect(newComposerForm().status).toBe('DRAFT');
    });
});

describe('changeItemType', () => {
    it('carries the question from a question of the day to a poll, without the key', () => {
        const qotd = newItemForm('QUESTION_OF_DAY', { title: 'Q' });
        if (qotd.itemType !== 'QUESTION_OF_DAY') throw new Error('type');
        qotd.question.options = [
            { id: 'a', text: 'Yes' },
            { id: 'b', text: 'No' },
        ];
        const poll = changeItemType(qotd, 'POLL');
        expect(poll.itemType).toBe('POLL');
        if (poll.itemType !== 'POLL') throw new Error('type');
        expect(poll.question.options.map((o) => o.text)).toEqual(['Yes', 'No']);
        expect(poll.question.correctOptionId).toBe('');
        expect(poll.title).toBe('Q');
        expect(poll.key).toBe(qotd.key);
    });

    it('clears content the new type cannot use', () => {
        const reading = newItemForm('READING_HTML', { title: 'R' });
        if (reading.itemType === 'READING_HTML') reading.contentHtml = '<p>Body</p>';
        const deck = changeItemType(reading, 'FLASHCARDS');
        expect(deck).not.toHaveProperty('contentHtml');
        const note = changeItemType(reading, 'VISUAL_NOTE');
        expect(note.itemType === 'VISUAL_NOTE' && note.contentHtml).toBe('<p>Body</p>');
    });
});

describe('requestToForm', () => {
    it('opens an AI draft with every day and task', () => {
        const form = requestToForm({
            title: 'AI plan',
            packageSessionIds: ['ps-1', 'ps-2'],
            slots: [
                {
                    title: 'Day 1',
                    startDate: '2026-09-24',
                    startTime: '06:00',
                    endTime: '20:00',
                    items: [
                        {
                            itemType: 'QUESTION_OF_DAY',
                            title: 'Q',
                            payloadJson: LEGACY_QOTD_PAYLOAD,
                            completionPoints: 10,
                            correctPoints: 20,
                        },
                    ],
                },
            ],
        });
        expect(form.packageSessionIds).toEqual(['ps-1', 'ps-2']);
        expect(form.slots[0]?.items[0]?.itemType).toBe('QUESTION_OF_DAY');
        const request = formToRequest(form);
        expect(request.packageSessionIds).toEqual(['ps-1', 'ps-2']);
        expect(request.slots?.[0]?.items?.[0]?.payloadJson).toBe(LEGACY_QOTD_PAYLOAD);
    });
});

describe('flattenFormErrors', () => {
    it('lists nested errors with dotted paths and skips refs', () => {
        const errors = {
            title: { type: 'custom', message: 'composer.errors.title', ref: {} },
            slots: [
                undefined,
                {
                    items: Object.assign(
                        [{ title: { type: 'too_small', message: 'composer.errors.taskTitle' } }],
                        { root: { type: 'custom', message: 'composer.errors.tasks' } }
                    ),
                },
            ],
        };
        expect(flattenFormErrors(errors)).toEqual([
            { path: 'title', message: 'composer.errors.title' },
            { path: 'slots.1.items.0.title', message: 'composer.errors.taskTitle' },
            { path: 'slots.1.items.root', message: 'composer.errors.tasks' },
        ]);
    });
});

describe('days after joining (RELATIVE plans)', () => {
    function relativePlan(): EngagementPlanDTO {
        const plan = demoPlan();
        plan.scheduleMode = 'RELATIVE';
        // The server stores Day N as 2000-01-01 + (N - 1) and sends startDay/endDay.
        plan.slots![0] = {
            ...plan.slots![0]!,
            startDate: '2000-01-01',
            endDate: '2000-01-03',
            startDay: 1,
            endDay: 3,
        };
        plan.slots![1] = {
            ...plan.slots![1]!,
            startDate: '2000-01-05',
            endDate: null,
            startDay: 5,
            endDay: 5,
        };
        plan.slots![2] = {
            ...plan.slots![2]!,
            startDate: '2000-01-06',
            endDate: null,
            startDay: 6,
            endDay: 6,
        };
        return plan;
    }

    it('round-trips Day N as startDay/endDay and never sends a mode on update', () => {
        const request = formToRequest(dtoToForm(relativePlan()));
        expect(request.scheduleMode).toBeUndefined();
        expect(
            request.slots!.map((s) => [s.startDay, s.endDay]).sort((x, y) => x[0]! - y[0]!)
        ).toEqual([
            [1, 3],
            [5, 5],
            [6, 6],
        ]);
    });

    it('sends the mode on create and starts a new relative plan on Day 1', () => {
        const form = newComposerForm({ scheduleMode: 'RELATIVE', packageSessionIds: ['ps-1'] });
        const request = formToRequest({ ...form, title: 'Onboarding' });
        expect(request.scheduleMode).toBe('RELATIVE');
        expect(request.slots![0]!.startDay).toBe(1);
        expect(request.slots![0]!.endDay).toBe(1);
    });

    it('calendar plans send no day numbers', () => {
        const request = formToRequest(dtoToForm(demoPlan()));
        expect(request.slots!.every((s) => s.startDay === undefined)).toBe(true);
    });

    it('rejects a day past 366', () => {
        const form = dtoToForm(relativePlan());
        form.slots[1]!.startDate = relativeDate(400);
        const result = composerSchema.safeParse(form);
        expect(result.success).toBe(false);
        expect(result.error!.issues.some((i) => i.message === COMPOSER_ERRORS.dayNumber)).toBe(
            true
        );
    });

    it('rebases days between calendar dates and Day 1, keeping their spacing', () => {
        const calendar = dtoToForm(demoPlan());
        const days = rebaseSlots(calendar.slots, RELATIVE_DAY_ONE).map((s) =>
            relativeDayOf(s.startDate)
        );
        const gaps = calendar.slots.map((s) => s.startDate);
        expect(days[0]).toBe(1);
        expect(days[1]! - days[0]!).toBe(
            (Date.parse(gaps[1]!) - Date.parse(gaps[0]!)) / 86_400_000
        );
    });

    it('a published relative plan reads as running, with no calendar range', () => {
        const plan = { ...relativePlan(), status: 'PUBLISHED' as const, todayState: null };
        expect(planLifecycle(plan)).toBe('RUNNING');
    });
});
