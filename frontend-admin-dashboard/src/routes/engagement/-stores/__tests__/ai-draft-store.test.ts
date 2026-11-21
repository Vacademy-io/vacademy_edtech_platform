import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../-services/ai-plan-service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../-services/ai-plan-service')>();
    return {
        ...actual,
        startAiPlanJob: vi.fn(),
        getAiPlanJob: vi.fn(),
        cancelAiPlanJob: vi.fn(async () => null),
        ackAiPlanJob: vi.fn(async () => undefined),
        draftAiPlan: vi.fn(),
    };
});

import * as service from '../../-services/ai-plan-service';
import {
    aiBriefSchema,
    briefRequestedCounts,
    briefRunDates,
    briefToRequest,
    compactGrounding,
    defaultAiBrief,
    MAX_GROUNDING_CHARS,
    maskToIsoWeekdays,
    resetAiDraftStoreForTests,
    useAiDraftStore,
    type AiBriefValues,
} from '../ai-draft-store';

const mocked = vi.mocked(service);

function brief(overrides: Partial<AiBriefValues> = {}): AiBriefValues {
    return {
        ...defaultAiBrief({ batches: [{ id: 'ps-1', label: 'Batch A' }] }),
        topic: 'Newton',
        startDate: '2099-01-05', // a Monday
        ...overrides,
    };
}

const DRAFT = {
    title: 'Forces week',
    model: 'm',
    days_planned: 1,
    items_planned: 1,
    grounded: true,
    slots: [
        {
            startDate: '2099-01-05',
            startTime: '06:00',
            endTime: '20:00',
            items: [{ itemType: 'POLL' as const, title: 'Which force?', isRequired: true }],
        },
    ],
};

describe('brief model', () => {
    it('lists run dates filtered by weekday, and ignores weekdays for one day', () => {
        // Mon..Fri only (Mon=1 … Fri=16).
        const weekdays = 1 | 2 | 4 | 8 | 16;
        expect(briefRunDates({ startDate: '2099-01-05', spanDays: 7, dowMask: weekdays })).toEqual([
            '2099-01-05',
            '2099-01-06',
            '2099-01-07',
            '2099-01-08',
            '2099-01-09',
        ]);
        expect(briefRunDates({ startDate: '2099-01-10', spanDays: 1, dowMask: 1 })).toEqual([
            '2099-01-10',
        ]);
        expect(maskToIsoWeekdays(weekdays)).toEqual([1, 2, 3, 4, 5]);
        expect(maskToIsoWeekdays(0)).toEqual([]);
    });

    it('builds the AI request: days = span, ISO weekdays, flashcards instead of game', () => {
        const req = briefToRequest(
            brief({ spanDays: 7, dowMask: 1 | 4, kinds: { ...brief().kinds, flashcards: true } }),
            [{ title: 'L1', text: '<p>x</p>' }]
        );
        expect(req.days).toBe(7);
        expect(req.start_date).toBe('2099-01-05');
        expect(req.weekdays).toEqual([1, 3]);
        // The exact run dates travel too (Mon 5 and Wed 7), so the service drafts them.
        expect(req.dates).toEqual(['2099-01-05', '2099-01-07']);
        // One day never sends weekdays (the service would filter the start date out).
        const oneDay = briefToRequest(brief({ spanDays: 1, dowMask: 2 }), []);
        expect(oneDay.weekdays).toBeUndefined();
        expect(oneDay.dates).toEqual(['2099-01-05']);
        expect(req.mix.flashcards).toBe(true);
        expect(req.mix.game).toBe(false);
        expect(req.grounding_texts).toHaveLength(1);
        expect(briefRequestedCounts(brief({ spanDays: 7, dowMask: 1 | 4 }))).toEqual({
            days: 2,
            items: 4,
        });
    });

    it('validates: a batch, a topic or chapters, a kind, and an end after the start', () => {
        const bad = aiBriefSchema.safeParse(
            brief({
                batches: [],
                topic: '',
                kinds: {
                    question_of_day: false,
                    text_question: false,
                    poll: false,
                    reading: false,
                    flashcards: false,
                },
                startTime: '10:00',
                endTime: '09:00',
            })
        );
        expect(bad.success).toBe(false);
        const messages = bad.success ? [] : bad.error.issues.map((i) => i.message);
        expect(messages).toEqual(
            expect.arrayContaining([
                'wizard.errors.batch',
                'wizard.errors.topic',
                'wizard.errors.kinds',
                'composer.errors.time',
            ])
        );
        expect(aiBriefSchema.safeParse(brief()).success).toBe(true);
        expect(
            aiBriefSchema.safeParse(brief({ spanDays: 7, dowMask: 64 /* Sun only */ })).success
        ).toBe(true);
    });
});

describe('service readers', () => {
    it('reads a job view tolerantly', () => {
        const running = service.normaliseJobView({
            task_id: 't1',
            status: 'PROGRESS',
            progress: { days_done: 3, days_total: 7 },
        });
        expect(running).toMatchObject({
            taskId: 't1',
            status: 'RUNNING',
            daysDone: 3,
            daysTotal: 7,
        });
        const done = service.normaliseJobView({
            task_id: 't1',
            status: 'COMPLETED',
            result: { ...DRAFT, requested: { days: 2, items: 4 } },
        });
        expect(done?.status).toBe('READY');
        expect(done?.draft?.requested).toEqual({ days: 2, items: 4 });
        expect(done?.draft?.delivered).toEqual({ days: 1, items: 1 });
        expect(service.normaliseJobView({ status: 'X' })).toBeNull();
    });

    it('reads the ai_service job payload (flat requested counts, short dates, charged)', () => {
        const view = service.normaliseJobView({
            task_id: 't2',
            status: 'COMPLETED',
            progress: { phase: 'done', days_done: 1, days_total: 2 },
            result: {
                ...DRAFT,
                days_requested: 2,
                items_requested: 4,
                missing_dates: ['2099-01-06'],
                short_dates: ['2099-01-05'],
                dropped_items: 1,
            },
            charged: true,
            error: '',
        });
        expect(view).toMatchObject({ status: 'READY', charged: true, error: null });
        expect(view?.draft).toMatchObject({
            requested: { days: 2, items: 4 },
            delivered: { days: 1, items: 1 },
            missingDates: ['2099-01-06'],
            shortDates: ['2099-01-05'],
            droppedItems: 1,
        });
    });

    it('keeps the task type on a new version', () => {
        expect(service.singleItemTypeFor('QUESTION_OF_DAY', 'TEXT')).toBe('TEXT_QUESTION');
        expect(service.singleItemTypeFor('QUESTION_OF_DAY', 'MCQ')).toBe('QUESTION_OF_DAY');
        expect(service.singleItemTypeFor('FLASHCARDS')).toBe('FLASHCARDS');
        expect(service.singleItemTypeFor('COURSE_SLIDE')).toBeNull();
        expect(service.mixForSingle('FLASHCARDS')).toMatchObject({
            flashcards: true,
            question_of_day: false,
            game: false,
        });
    });
});

describe('draft store', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        sessionStorage.clear();
        resetAiDraftStoreForTests();
        useAiDraftStore.getState().hydrate();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('runs a job: start, poll progress, land as the review, ack, bump credits', async () => {
        mocked.startAiPlanJob.mockResolvedValue({
            taskId: 't1',
            status: 'RUNNING',
            daysDone: 0,
            daysTotal: 1,
            phase: null,
            draft: null,
            error: null,
            elapsedSeconds: 0,
            creditsCharged: null,
            charged: null,
        });
        mocked.getAiPlanJob
            .mockResolvedValueOnce({
                taskId: 't1',
                status: 'RUNNING',
                daysDone: 1,
                daysTotal: 1,
                phase: null,
                draft: null,
                error: null,
                elapsedSeconds: 3,
                creditsCharged: null,
                charged: null,
            })
            .mockResolvedValueOnce({
                taskId: 't1',
                status: 'READY',
                daysDone: 1,
                daysTotal: 1,
                phase: null,
                draft: service.normaliseDraft(DRAFT),
                error: null,
                elapsedSeconds: 5,
                creditsCharged: 12,
                charged: true,
            });

        await useAiDraftStore.getState().startDraft({
            brief: brief({ spanDays: 1 }),
            grounding: [],
            idempotencyKey: 'k1',
            credits: 10,
        });
        expect(useAiDraftStore.getState().job?.taskId).toBe('t1');

        await vi.advanceTimersByTimeAsync(0);
        expect(useAiDraftStore.getState().job?.daysDone).toBe(1);
        await vi.advanceTimersByTimeAsync(2600);

        const state = useAiDraftStore.getState();
        expect(state.job).toBeNull();
        expect(state.review?.plan.title).toBe('Forces week');
        expect(state.review?.plan.packageSessionIds).toEqual(['ps-1']);
        expect(state.review?.creditsSpent).toBe(12);
        expect(state.creditsSeq).toBe(1);
        expect(mocked.ackAiPlanJob).toHaveBeenCalledWith('t1');
        // Mirrored for a reload.
        expect(sessionStorage.getItem('engagement.aiDraft.v2.inst-1')).toContain('Forces week');
    });

    it('falls back to the synchronous draft when the jobs endpoint is missing', async () => {
        mocked.startAiPlanJob.mockResolvedValue(null);
        mocked.draftAiPlan.mockResolvedValue(service.normaliseDraft(DRAFT)!);
        await useAiDraftStore.getState().startDraft({
            brief: brief({ spanDays: 1 }),
            grounding: [],
            idempotencyKey: 'k2',
            credits: 10,
        });
        expect(mocked.draftAiPlan).toHaveBeenCalledTimes(1);
        const [, key] = mocked.draftAiPlan.mock.calls[0]!;
        expect(key).toBe('k2');
        expect(useAiDraftStore.getState().review?.creditsSpent).toBe(10);
        expect(useAiDraftStore.getState().review?.delivered).toEqual({ days: 1, items: 1 });
    });

    it('cancels a running job on the server and keeps the brief for a retry', async () => {
        mocked.startAiPlanJob.mockResolvedValue({
            taskId: 't9',
            status: 'RUNNING',
            daysDone: 0,
            daysTotal: 7,
            phase: null,
            draft: null,
            error: null,
            elapsedSeconds: 0,
            creditsCharged: null,
            charged: null,
        });
        await useAiDraftStore.getState().startDraft({
            brief: brief(),
            grounding: [],
            idempotencyKey: 'k3',
            credits: 10,
        });
        await useAiDraftStore.getState().cancelJob();
        expect(mocked.cancelAiPlanJob).toHaveBeenCalledWith('t9');
        expect(useAiDraftStore.getState().job?.status).toBe('CANCELLED');
        expect(useAiDraftStore.getState().job?.brief.topic).toBe('Newton');
    });

    it('a cancel that arrives after the draft finished keeps the (charged) draft', async () => {
        mocked.startAiPlanJob.mockResolvedValue({
            taskId: 't10',
            status: 'RUNNING',
            daysDone: 0,
            daysTotal: 1,
            phase: null,
            draft: null,
            error: null,
            elapsedSeconds: 0,
            creditsCharged: null,
            charged: null,
        });
        // The server's cancel answers with the finished job (ai_service's _job_view).
        mocked.cancelAiPlanJob.mockResolvedValueOnce(
            service.normaliseJobView({
                task_id: 't10',
                status: 'COMPLETED',
                progress: { phase: 'done', days_done: 1, days_total: 1 },
                result: DRAFT,
                charged: true,
            })
        );
        await useAiDraftStore.getState().startDraft({
            brief: brief({ spanDays: 1 }),
            grounding: [],
            idempotencyKey: 'k10',
            credits: 10,
        });
        await useAiDraftStore.getState().cancelJob();
        const state = useAiDraftStore.getState();
        expect(state.job).toBeNull();
        expect(state.review?.plan.title).toBe('Forces week');
        expect(state.creditsSeq).toBe(1);
    });

    it('reports a failed start with the server sentence', async () => {
        const error = Object.assign(new Error('402'), {
            isAxiosError: true,
            response: { status: 402, data: { detail: 'Insufficient credits: …' } },
        });
        mocked.startAiPlanJob.mockRejectedValue(error);
        await useAiDraftStore.getState().startDraft({
            brief: brief(),
            grounding: [],
            idempotencyKey: 'k4',
            credits: 10,
        });
        expect(useAiDraftStore.getState().job).toMatchObject({
            status: 'FAILED',
            error: 'Insufficient credits: …',
        });
    });

    it('cancel during the start never drafts, and stops a job the server did start', async () => {
        let resolveStart: (
            v: Awaited<ReturnType<typeof service.startAiPlanJob>>
        ) => void = () => {};
        mocked.startAiPlanJob.mockImplementation(
            () => new Promise((resolve) => (resolveStart = resolve))
        );
        const started = useAiDraftStore.getState().startDraft({
            brief: brief(),
            grounding: [],
            idempotencyKey: 'k5',
            credits: 10,
        });
        await useAiDraftStore.getState().cancelJob();
        resolveStart({
            taskId: 't5',
            status: 'RUNNING',
            daysDone: 0,
            daysTotal: 7,
            phase: null,
            draft: null,
            error: null,
            elapsedSeconds: 0,
            creditsCharged: null,
            charged: null,
        });
        await started;
        expect(mocked.cancelAiPlanJob).toHaveBeenCalledWith('t5');
        expect(useAiDraftStore.getState().job?.status).toBe('CANCELLED');

        // Against an AI service without jobs: cancelled before the fallback = no draft.
        mocked.startAiPlanJob.mockResolvedValueOnce(null);
        const again = useAiDraftStore.getState().startDraft({
            brief: brief(),
            grounding: [],
            idempotencyKey: 'k6',
            credits: 10,
        });
        await useAiDraftStore.getState().cancelJob();
        await again;
        expect(mocked.draftAiPlan).not.toHaveBeenCalled();
    });

    it('counts the run dates (not the span) as the days to draft', async () => {
        mocked.startAiPlanJob.mockImplementation(() => new Promise(() => {}));
        void useAiDraftStore.getState().startDraft({
            // Mon..Fri over a week: 5 days, not 7.
            brief: brief({ spanDays: 7, dowMask: 1 | 2 | 4 | 8 | 16 }),
            grounding: [],
            idempotencyKey: 'k7',
            credits: 10,
        });
        expect(useAiDraftStore.getState().job?.daysTotal).toBe(5);
    });

    it('keeps the compact grounding with the draft across a reload', async () => {
        mocked.startAiPlanJob.mockResolvedValue(null);
        mocked.draftAiPlan.mockResolvedValue(service.normaliseDraft(DRAFT)!);
        await useAiDraftStore.getState().startDraft({
            brief: brief({ spanDays: 1 }),
            grounding: [{ title: 'Forces', text: '<p>Push &amp; pull</p>' }],
            idempotencyKey: 'k8',
            credits: 10,
        });
        const [request] = mocked.draftAiPlan.mock.calls[0]!;
        expect(request.grounding_texts).toEqual([{ title: 'Forces', text: 'Push & pull' }]);
        resetAiDraftStoreForTests();
        useAiDraftStore.getState().hydrate();
        expect(useAiDraftStore.getState().review?.plan.title).toBe('Forces week');
        expect(useAiDraftStore.getState().grounding).toEqual([
            { title: 'Forces', text: 'Push & pull' },
        ]);
    });

    it('a job whose start never answered is reported as interrupted after a reload', () => {
        sessionStorage.setItem(
            'engagement.aiDraft.v2.inst-1',
            JSON.stringify({
                v: 2,
                review: null,
                job: {
                    mode: 'job',
                    taskId: null,
                    status: 'RUNNING',
                    startedAt: 1,
                    daysDone: 0,
                    daysTotal: 1,
                    error: null,
                    errorKey: null,
                    brief: brief(),
                    idempotencyKey: 'k9',
                    credits: 10,
                },
            })
        );
        resetAiDraftStoreForTests();
        useAiDraftStore.getState().hydrate();
        expect(useAiDraftStore.getState().job?.status).toBe('INTERRUPTED');
    });
});

describe('grounding and pictures', () => {
    it('compacts grounding like ai_service: plain text, in order, capped', () => {
        const big = 'a'.repeat(MAX_GROUNDING_CHARS);
        const out = compactGrounding([
            { title: 'One', text: '<h2>Hi</h2><p>there&nbsp;you</p>' },
            { text: '   ' },
            { title: 'Two', text: big },
        ]);
        expect(out[0]).toEqual({ title: 'One', text: 'Hi there you' });
        expect(out).toHaveLength(2);
        const total = out.reduce(
            (n, g) => n + g.text.length + (g.title ? g.title.length + 4 : 0),
            0
        );
        expect(total).toBeLessThanOrEqual(MAX_GROUNDING_CHARS);
    });

    it('strips unfilled picture slots and keeps real pictures', () => {
        const html =
            '<p>a</p><img data-img-prompt="x" src="placeholder.png" alt="x">' +
            '<img data-img-prompt="y" alt="y"><img src="https://cdn/x.png" alt="real">';
        expect(service.stripImagePlaceholders(html)).toBe(
            '<p>a</p><img src="https://cdn/x.png" alt="real">'
        );
        const plan = service.withoutImagePlaceholders({
            slots: [
                {
                    startDate: '2099-01-05',
                    startTime: '06:00',
                    endTime: '20:00',
                    items: [{ itemType: 'READING_HTML' as const, title: 'R', contentHtml: html }],
                },
            ],
        });
        expect(plan.slots?.[0]?.items?.[0]?.contentHtml).not.toContain('data-img-prompt');
    });
});
