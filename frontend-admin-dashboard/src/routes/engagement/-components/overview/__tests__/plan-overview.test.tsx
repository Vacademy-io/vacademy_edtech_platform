import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LearnerProgress, PlanOverview } from '../../../-types/types';

/**
 * The plan overview: pure helpers plus one render against a mocked overview, checking
 * the WP-4B acceptance (a learner with nothing done is "Not started", and the tile
 * reads 1 in a warning tone once the plan has begun).
 */

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts && 'count' in opts ? `${key}:${String(opts.count)}` : key,
        i18n: { language: 'en' },
    }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const getPlanOverview = vi.fn();
const exportPlanOverview = vi.fn();
vi.mock('../../../-services/engagement-service', () => ({
    getPlanOverview: (...args: unknown[]) => getPlanOverview(...args),
    exportPlanOverview: (...args: unknown[]) => exportPlanOverview(...args),
}));

// MyTable mounts app dialogs that read localStorage, which this environment lacks.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
});

// Recharts needs a measured box; the chart itself is not under test here.
vi.mock('../CompletionByDayChart', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../CompletionByDayChart')>();
    return {
        ...actual,
        CompletionByDayChart: ({ days }: { days?: unknown[] | null }) => (
            <div data-testid="chart">{days?.length ?? 0}</div>
        ),
    };
});

const { PlanOverviewDialog, leastCompletedTasks, overviewTileCounts, pageRowsLocally } =
    await import('../../PlanOverviewDialog');
const { learnerClassOf } = await import('../LearnerTable');
const { tileTone } = await import('../OverviewTiles');
const { toCompletionData, averageCompletion } = await import('../CompletionByDayChart');

function learner(overrides: Partial<LearnerProgress>): LearnerProgress {
    return {
        userId: 'u',
        fullName: 'Someone',
        username: 'someone',
        completed: 0,
        correct: 0,
        pointsEarned: 0,
        missed: 0,
        lastCompletedAt: null,
        ...overrides,
    };
}

describe('learnerClassOf', () => {
    it('trusts the server class', () => {
        expect(learnerClassOf(learner({ class: 'BEHIND', completed: 9 }))).toBe('BEHIND');
    });
    it('derives it for an older server', () => {
        expect(learnerClassOf(learner({ completed: 0 }))).toBe('NOT_STARTED');
        expect(learnerClassOf(learner({ done: 2, available: 5 }))).toBe('BEHIND');
        expect(learnerClassOf(learner({ done: 3, available: 5 }))).toBe('ON_TRACK');
        expect(learnerClassOf(learner({ completed: 1 }))).toBe('ON_TRACK');
    });
});

describe('tileTone', () => {
    it('is neutral for zero and before the plan begins', () => {
        expect(tileTone('notStarted', 0, true)).toBe('neutral');
        expect(tileTone('notStarted', 4, false)).toBe('neutral');
        expect(tileTone('onTrack', 0, true)).toBe('neutral');
    });
    it('warns for not started / behind, and is success for on track', () => {
        expect(tileTone('notStarted', 1, true)).toBe('warning');
        expect(tileTone('behind', 2, true)).toBe('warning');
        expect(tileTone('onTrack', 3, true)).toBe('success');
    });
});

describe('leastCompletedTasks', () => {
    it('keeps opened, visible tasks, lowest rate first, unknown rates last', () => {
        const { shown, opened } = leastCompletedTasks(
            [
                {
                    itemId: 'a',
                    title: 'A',
                    itemType: 'POLL',
                    state: 'OPEN',
                    completed: 5,
                    rate: 0.5,
                },
                {
                    itemId: 'b',
                    title: 'B',
                    itemType: 'POLL',
                    state: 'UPCOMING',
                    completed: 0,
                    rate: 0,
                },
                {
                    itemId: 'c',
                    title: 'C',
                    itemType: 'POLL',
                    state: 'CLOSED',
                    completed: 1,
                    rate: 0.1,
                },
                {
                    itemId: 'd',
                    title: 'D',
                    itemType: 'POLL',
                    state: 'OPEN',
                    capHidden: true,
                    completed: 0,
                    rate: 0,
                },
                {
                    itemId: 'e',
                    title: 'E',
                    itemType: 'POLL',
                    state: 'CATCH_UP',
                    completed: 0,
                    rate: null,
                },
            ],
            2
        );
        expect(opened).toBe(3);
        expect(shown.map((t) => t.itemId)).toEqual(['c', 'a']);
    });
    it('handles a missing list', () => {
        expect(leastCompletedTasks(null)).toEqual({ shown: [], opened: 0 });
    });
});

describe('overviewTileCounts', () => {
    const base: PlanOverview = {
        planId: 'p',
        title: 'Plan',
        tasksClosed: 0,
        tasksTotal: 3,
        learners: 3,
        learnersActive: 1,
        learnersSlipping: 0,
        rows: [],
    };
    it('uses the batch-wide server counts', () => {
        expect(overviewTileCounts({ ...base, notStarted: 1, behind: 0, onTrack: 2 })).toEqual({
            notStarted: 1,
            behind: 0,
            onTrack: 2,
            learners: 3,
        });
    });
    it('counts rows for an older server', () => {
        const rows = [
            learner({ completed: 0 }),
            learner({ completed: 2 }),
            learner({ done: 1, available: 4 }),
        ];
        expect(overviewTileCounts({ ...base, rows })).toEqual({
            notStarted: 1,
            behind: 1,
            onTrack: 1,
            learners: 3,
        });
    });
});

describe('pageRowsLocally', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
        learner({ userId: `u${i}`, fullName: `Learner ${i}`, completed: i % 2 })
    );
    it('pages', () => {
        const r = pageRowsLocally(rows, { page: 1, size: 2, q: '', needsAttention: false });
        expect(r.rows.map((x) => x.userId)).toEqual(['u2', 'u3']);
        expect(r.totalPages).toBe(3);
        expect(r.totalRows).toBe(5);
    });
    it('searches and filters', () => {
        expect(
            pageRowsLocally(rows, { page: 0, size: 20, q: 'learner 3', needsAttention: false }).rows
        ).toHaveLength(1);
        expect(
            pageRowsLocally(rows, { page: 0, size: 20, q: '', needsAttention: true }).totalRows
        ).toBe(3);
    });
    it('clamps a page past the end', () => {
        const r = pageRowsLocally(rows, { page: 9, size: 2, q: '', needsAttention: false });
        expect(r.rows.map((x) => x.userId)).toEqual(['u4']);
    });
});

describe('completion data', () => {
    it('maps days, falls back to completed/available, marks today', () => {
        const data = toCompletionData(
            [
                { date: '2026-09-24', tasks: 2, completed: 3, available: 4, rate: 0.75 },
                { date: '2026-09-25', tasks: 1, completed: 1, available: 4, rate: null },
                { date: '2026-09-26', tasks: 1, completed: 0, available: 0, rate: null },
            ],
            'en',
            '2026-09-26'
        );
        expect(data.map((d) => d.percent)).toEqual([75, 25, null]);
        expect(data.map((d) => d.isToday)).toEqual([false, false, true]);
        expect(averageCompletion(data)).toBe(0.5);
    });
    it('has no average without data', () => {
        expect(averageCompletion(toCompletionData([], 'en'))).toBeNull();
    });
});

describe('PlanOverviewDialog', () => {
    beforeEach(() => {
        getPlanOverview.mockReset();
        exportPlanOverview.mockReset();
    });

    function renderDialog() {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        return render(
            <QueryClientProvider client={client}>
                <PlanOverviewDialog planId="plan-1" open onOpenChange={() => {}} />
            </QueryClientProvider>
        );
    }

    it('shows a learner with nothing done as Not started, with a warning tile', async () => {
        getPlanOverview.mockResolvedValue({
            planId: 'plan-1',
            title: 'UI review demo',
            tasksClosed: 1,
            tasksTotal: 11,
            learners: 2,
            learnersActive: 1,
            learnersSlipping: 1,
            notStarted: 1,
            behind: 0,
            onTrack: 1,
            tasksOpened: 11,
            today: '2026-09-26',
            days: [{ date: '2026-09-25', tasks: 11, completed: 11, available: 22, rate: 0.5 }],
            tasks: [
                {
                    itemId: 'i1',
                    title: 'Poll of the day',
                    itemType: 'POLL',
                    state: 'OPEN',
                    completed: 1,
                    started: 0,
                    rate: 0.5,
                },
            ],
            rows: [
                learner({
                    userId: 'deepankar',
                    fullName: 'Deepankar',
                    class: 'NOT_STARTED',
                    done: 0,
                    available: 11,
                    overdue: 2,
                }),
                learner({
                    userId: 'riya',
                    fullName: 'Riya',
                    class: 'ON_TRACK',
                    completed: 11,
                    done: 11,
                    available: 11,
                    overdue: 0,
                    pointsEarned: 110,
                    lastCompletedAt: '2026-09-25T10:00:00Z',
                }),
            ],
            page: 0,
            pageSize: 20,
            totalRows: 2,
            totalPages: 1,
        });

        renderDialog();

        await screen.findByText('Deepankar');
        expect(getPlanOverview).toHaveBeenCalledWith('plan-1', {
            page: 0,
            size: 20,
            q: undefined,
            needsAttention: false,
        });

        // Row chip + tile label both read "Not started".
        const labels = screen.getAllByText('overview.class.NOT_STARTED');
        expect(labels.length).toBeGreaterThanOrEqual(2);
        const tile = labels
            .map((el) => el.closest('div.rounded-lg'))
            .find((el) => el?.className.includes('px-4'));
        expect(tile?.className).toContain('border-warning-200');
        expect(tile?.textContent).toContain('1');

        expect(screen.getByText('Poll of the day')).toBeTruthy();
        expect(screen.getByTestId('chart').textContent).toBe('1');
    });

    it('asks the server for the needs-attention page when the filter is used', async () => {
        getPlanOverview.mockResolvedValue({
            planId: 'plan-1',
            title: 'Plan',
            tasksClosed: 0,
            tasksTotal: 1,
            learners: 1,
            learnersActive: 0,
            learnersSlipping: 0,
            notStarted: 1,
            behind: 0,
            onTrack: 0,
            tasksOpened: 1,
            rows: [learner({ userId: 'x', fullName: 'Xavier', class: 'NOT_STARTED' })],
            page: 0,
            pageSize: 20,
            totalRows: 1,
            totalPages: 1,
        });
        renderDialog();
        await screen.findByText('Xavier');
        fireEvent.click(screen.getByText('overview.table.filterNeedsAttention:1'));
        await waitFor(() =>
            expect(getPlanOverview).toHaveBeenLastCalledWith('plan-1', {
                page: 0,
                size: 20,
                q: undefined,
                needsAttention: true,
            })
        );
    });

    it('starts a new filter from the first page, with no request for a stale page', async () => {
        getPlanOverview.mockImplementation(
            async (_planId: string, params: { page: number; needsAttention?: boolean }) => ({
                planId: 'plan-1',
                title: 'Plan',
                tasksClosed: 0,
                tasksTotal: 1,
                learners: 45,
                learnersActive: 0,
                learnersSlipping: 0,
                notStarted: 45,
                behind: 0,
                onTrack: 0,
                tasksOpened: 1,
                rows: [
                    learner({
                        userId: `p${params.page}`,
                        fullName: `Page ${params.page}`,
                        class: 'NOT_STARTED',
                    }),
                ],
                page: params.page,
                pageSize: 20,
                totalRows: 45,
                totalPages: 3,
            })
        );
        renderDialog();
        await screen.findByText('Page 0');
        const pageTwo = screen
            .getAllByText('2')
            .find((el) => el.closest('nav, [role=navigation], a, button'));
        expect(pageTwo).toBeTruthy();
        fireEvent.click(pageTwo as HTMLElement);
        await screen.findByText('Page 1');
        getPlanOverview.mockClear();
        fireEvent.click(screen.getByText('overview.table.filterNeedsAttention:45'));
        await waitFor(() =>
            expect(getPlanOverview).toHaveBeenLastCalledWith('plan-1', {
                page: 0,
                size: 20,
                q: undefined,
                needsAttention: true,
            })
        );
        expect(getPlanOverview).not.toHaveBeenCalledWith(
            'plan-1',
            expect.objectContaining({ page: 1, needsAttention: true })
        );
    });

    it('shows the error state with a retry', async () => {
        getPlanOverview.mockRejectedValue(new Error('boom'));
        renderDialog();
        await screen.findByText('overview.loadError');
        expect(screen.getByText('overview.retry')).toBeTruthy();
    });
});
