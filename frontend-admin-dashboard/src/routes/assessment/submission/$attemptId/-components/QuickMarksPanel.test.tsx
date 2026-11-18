import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestI18n } from '@/services/submission-review/test-i18n';
import { attemptMarking, outline, qrow, release } from '@/services/submission-review/test-fixtures';
import { useSubmissionNavStore } from '@/services/submission-review/nav-store';
import type { SubmissionOutline } from '@/services/submission-review/types';

const api = vi.hoisted(() => ({
    saveQuickMarks: vi.fn(),
    getMarkingSummary: vi.fn(),
    parseApiError: (e: unknown) =>
        ((e as { response?: { data?: unknown } })?.response?.data as never) ?? null,
}));
vi.mock('@/services/submission-review/api', () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { QuickMarksPanel } from './QuickMarksPanel';

/** Acceptance 8: a 10-question handwritten copy. */
const tenQuestionCopy = (): SubmissionOutline =>
    outline({
        attempt_id: 'att-1',
        kind: 'SCANNED',
        marking: 'NEEDS_MARKING',
        max_total: 100,
        total: 0,
        sections: [
            {
                section_id: 's1',
                name: 'Section A',
                order: 0,
                total: 0,
                max: 100,
                questions: Array.from({ length: 10 }, (_, i) =>
                    qrow({ key: `s1:q${i + 1}`, question_number: i + 1, revision: 0 })
                ),
            },
        ],
    });

const renderPanel = (onNextAttempt = vi.fn(), o: SubmissionOutline = tenQuestionCopy()) => {
    render(
        <QueryClientProvider client={new QueryClient()}>
            <QuickMarksPanel outline={o} onNextAttempt={onNextAttempt} />
        </QueryClientProvider>
    );
    return onNextAttempt;
};

beforeAll(async () => {
    await setupTestI18n();
});
beforeEach(() => {
    api.saveQuickMarks.mockReset().mockResolvedValue({ rows: [], changed: 10, update_queued: false });
    api.getMarkingSummary.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    useSubmissionNavStore.getState().set('asmt-1', ['att-0', 'att-1', 'att-2', 'att-3'], 'list');
});

describe('QuickMarksPanel (W2b)', () => {
    it('acceptance 8: 6 marks + "mark the rest" + Save & next = one request with 10 items, then the next learner who needs marking', async () => {
        api.getMarkingSummary.mockResolvedValue({
            summary: {},
            attempts: {
                'att-0': attemptMarking({ marking: 'NEEDS_MARKING' }),
                'att-2': attemptMarking({ marking: 'DONE' }),
                'att-3': attemptMarking({ marking: 'NEEDS_MARKING' }),
            },
        });
        const onNext = renderPanel();
        ['6', '7', '5', '8', '3', '9'].forEach((v, i) => {
            fireEvent.change(screen.getByLabelText(`Marks for Q${i + 1}`), { target: { value: v } });
        });
        expect(screen.getByTestId('quick-total')).toHaveTextContent('Total 38 / 100');

        fireEvent.click(screen.getByRole('button', { name: 'Mark the rest as not answered (4)' }));
        expect(screen.queryByLabelText('Marks for Q7')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Save & next needs marking/ }));
        await waitFor(() => expect(api.saveQuickMarks).toHaveBeenCalledTimes(1));
        const [attemptId, body] = api.saveQuickMarks.mock.calls[0]!;
        expect(attemptId).toBe('att-1');
        expect(body.items).toHaveLength(10);
        expect(body.items.filter((i: { not_answered?: boolean }) => i.not_answered)).toHaveLength(4);
        expect(body.items[0]).toEqual({ section_id: 's1', question_id: 'q1', expected_revision: 0, marks: 6 });
        expect(body.expected_release).toBe('PENDING|0');

        // att-2 is done, so the next one is att-3 (A10 checked for the remaining ids).
        await waitFor(() => expect(onNext).toHaveBeenCalledWith('att-3'));
        expect(api.getMarkingSummary).toHaveBeenCalledWith('asmt-1', ['att-0', 'att-2', 'att-3']);
    });

    it('clamps a typed value to the max when the box loses focus', () => {
        renderPanel();
        const box = screen.getByLabelText('Marks for Q1');
        fireEvent.change(box, { target: { value: '14' } });
        fireEvent.blur(box);
        expect(box).toHaveValue(10);
    });

    it('a 409 STALE_REVISION keeps the boxes and says how many answers changed', async () => {
        api.saveQuickMarks.mockRejectedValue({
            response: { data: { code: 'STALE_REVISION', message: '', details: { stale_keys: ['s1:q1', 's1:q2'] } } },
        });
        renderPanel();
        fireEvent.change(screen.getByLabelText('Marks for Q1'), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(
                'Someone changed 2 answers a moment ago. The page is refreshed; your boxes are kept.'
            )
        );
        expect(screen.getByLabelText('Marks for Q1')).toHaveValue(4);
    });

    it('Save & next walks the whole test once the table page has nobody left (review 4 #1)', async () => {
        useSubmissionNavStore.getState().set('asmt-1', ['att-1', 'att-2'], 'list');
        api.getMarkingSummary.mockImplementation(async (_a: string, ids?: string[]) => {
            if (!ids) return { summary: { needs_marking_attempt_ids: ['att-1', 'att-9'] } };
            if (ids.includes('att-2')) return { summary: {}, attempts: { 'att-2': attemptMarking({ marking: 'DONE' }) } };
            return { summary: {}, attempts: { 'att-9': attemptMarking({ marking: 'NEEDS_MARKING' }) } };
        });
        const onNext = renderPanel();
        fireEvent.change(screen.getByLabelText('Marks for Q1'), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: /Save & next needs marking/ }));
        await waitFor(() => expect(onNext).toHaveBeenCalledWith('att-9'));
        expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/No one else/));
    });

    it('an online test has no "Mark the rest as not answered" (review 4 #7)', () => {
        renderPanel(vi.fn(), { ...tenQuestionCopy(), kind: 'ONLINE' });
        expect(screen.queryByRole('button', { name: /Mark the rest as not answered/ })).not.toBeInTheDocument();
    });

    it('after release, the send-update tick is off while other answers still need marking (review 4 #2)', async () => {
        renderPanel(vi.fn(), { ...tenQuestionCopy(), release: release({ status: 'RELEASED', token: 'RELEASED|5' }) });
        fireEvent.change(screen.getByLabelText('Marks for Q1'), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const tick = await screen.findByRole('checkbox', { name: /updated result/ });
        expect(tick).not.toBeChecked();
    });
    it('labels a locked objective row with who set its mark, not always "Answer key" (live follow-up B4)', () => {
        const o = outline({
            attempt_id: 'att-1',
            kind: 'ONLINE',
            sections: [
                {
                    section_id: 's1',
                    name: 'Section A',
                    order: 0,
                    total: 3.5,
                    max: 4,
                    questions: [
                        qrow({ key: 's1:q1', question_number: 1, question_type: 'MCQS', marks: 2, max_marks: 2,
                            state: 'MARKED', marks_source: null, marked_by_kind: 'ANSWER_KEY' }),
                        qrow({ key: 's1:q2', question_number: 2, question_type: 'MCQS', marks: 1.5, max_marks: 2,
                            state: 'MARKED', marks_source: 'MANUAL', marked_by_kind: 'TEACHER',
                            marked_by: { user_id: 't-1', name: 'Riya Jain' } }),
                    ],
                },
            ],
        });
        renderPanel(vi.fn(), o);
        const labels = screen.getAllByTestId('quick-locked-source').map((e) => e.textContent);
        expect(labels).toEqual(['Answer key', 'Marked by: Riya Jain']);
        // Objective rows stay out of Quick marks (Edit marks changes them, contract 9.8).
        expect(screen.queryByLabelText('Marks for Q2')).not.toBeInTheDocument();
    });
});
