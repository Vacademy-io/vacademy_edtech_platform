import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestI18n } from '@/services/submission-review/test-i18n';
import { outline, qrow, release } from '@/services/submission-review/test-fixtures';

const api = vi.hoisted(() => ({
    editMarks: vi.fn(),
    getQuestionDetail: vi.fn(),
    httpStatusOf: (e: unknown) => (e as { response?: { status?: number } })?.response?.status ?? null,
    parseApiError: (e: unknown) => ((e as { response?: { data?: unknown } })?.response?.data as never) ?? null,
}));
vi.mock('@/services/submission-review/api', () => api);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { EditMarksDialog } from './EditMarksDialog';

const row = qrow({ key: 's1:q12', question_number: 12, question_type: 'CBE_RESPONSE', max_marks: 16, revision: 2 });
const conflict = (data: unknown) => ({ response: { status: 409, data } });

const renderDialog = (o = outline()) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <EditMarksDialog outline={o} row={row} mode="edit" open onOpenChange={() => {}} />
        </QueryClientProvider>
    );

beforeAll(async () => {
    await setupTestI18n();
});
beforeEach(() => {
    api.editMarks.mockReset();
    api.getQuestionDetail.mockReset().mockResolvedValue({
        row,
        evaluator_feedback: null,
        part_marks: [],
        scheme_points: [],
        ai: null,
        answer: {},
    });
});

describe('EditMarksDialog (W4) conflicts', () => {
    it('acceptance 4: a stale revision says who changed it and Reload moves to the new revision', async () => {
        api.editMarks.mockImplementation((_a, _s, _q, body) =>
            body.preview
                ? Promise.resolve({ total_before: 2, total_after: 9, total_recomputed: null })
                : Promise.reject(
                      conflict({
                          code: 'STALE_REVISION',
                          message: '',
                          details: { current: { ...row, marks: 5, revision: 3, state: 'MARKED', marked_by: { user_id: 'r', name: 'Riya' } } },
                      })
                  )
        );
        renderDialog();
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save marks' }));
        expect(await screen.findByText('Riya changed this mark to 5 a moment ago.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        expect(screen.getByRole('spinbutton')).toHaveValue(5);
        api.editMarks.mockResolvedValue({ row, total_before: 2, total_after: 9, release: release(), update_queued: false });
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save marks' }));
        await waitFor(() =>
            expect(api.editMarks).toHaveBeenLastCalledWith('att-1', 's1', 'q12', expect.objectContaining({ marks: 7, expected_revision: 3 }))
        );
    });

    it('acceptance 4: a release mid-edit keeps the dialog open, asks for a reason and moves to the new token', async () => {
        const released = release({ status: 'RELEASED', token: 'RELEASED|99' });
        api.editMarks.mockImplementation((_a, _s, _q, body) =>
            body.preview
                ? Promise.resolve({ total_before: 2, total_after: 9, total_recomputed: null })
                : Promise.reject(conflict({ code: 'RELEASE_CHANGED', message: '', details: { release: released } }))
        );
        renderDialog();
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save marks' }));
        expect(
            await screen.findByText(
                'This result was released while you were editing. Add a reason and choose whether to tell Harsh Mehta.'
            )
        ).toBeInTheDocument();
        const save = screen.getByRole('button', { name: 'Save marks' });
        expect(save).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'Send Harsh Mehta the updated result' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.change(screen.getByPlaceholderText('Why the mark changed'), { target: { value: 'Marked by hand' } });
        api.editMarks.mockResolvedValue({ row, total_before: 2, total_after: 9, release: released, update_queued: true });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save marks' }));
        });
        await waitFor(() =>
            expect(api.editMarks).toHaveBeenLastCalledWith(
                'att-1',
                's1',
                'q12',
                expect.objectContaining({ expected_release: 'RELEASED|99', reason: 'Marked by hand', notify_learner: true })
            )
        );
    });

    it('shows the total preview from A3 preview=true', async () => {
        api.editMarks.mockResolvedValue({ total_before: 2, total_after: 9, total_recomputed: { stored_total: 1, r6_before: 2 } });
        renderDialog();
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });
        expect(await screen.findByTestId('edit-total-preview', {}, { timeout: 2000 })).toHaveTextContent('Total: 2 → 9');
        expect(screen.getByText(/The total will also change from 1 to 2/)).toBeInTheDocument();
    });
});
