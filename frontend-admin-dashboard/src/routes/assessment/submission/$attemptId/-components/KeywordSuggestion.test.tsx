import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestI18n } from '@/services/submission-review/test-i18n';
import { submissionKeys } from '@/services/submission-review/query-keys';
import { outline, qrow, release } from '@/services/submission-review/test-fixtures';
import type { QuestionRow, SubmissionOutline } from '@/services/submission-review/types';

const api = vi.hoisted(() => ({
    editMarks: vi.fn(),
    parseApiError: (e: unknown) =>
        ((e as { response?: { data?: unknown } })?.response?.data as never) ?? null,
}));
vi.mock('@/services/submission-review/api', () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import {
    canKeepKeyword,
    KeepKeywordButton,
    KeywordSuggestedText,
    useKeepKeyword,
} from './KeywordSuggestion';

const kw = (marks: number) =>
    qrow({
        key: 's1:q4',
        question_number: 4,
        marks,
        max_marks: 5,
        revision: 7,
        marked_by_kind: 'KEYWORD',
    });

const Harness = ({ o, row }: { o: SubmissionOutline; row: QuestionRow }) => {
    const keep = useKeepKeyword(o);
    return (
        <>
            <KeywordSuggestedText row={row} />
            <KeepKeywordButton row={row} onKeep={keep.keep} busy={keep.keepingKey === row.key} />
        </>
    );
};

const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

const SwitchHarness = ({
    o,
    row,
    onKept,
}: {
    o: SubmissionOutline;
    row: QuestionRow;
    onKept: (attemptId: string) => void;
}) => {
    const keep = useKeepKeyword(o, { onKept });
    return <KeepKeywordButton row={row} onKeep={keep.keep} busy={keep.keepingKey === row.key} />;
};

/** The outline is a live query, as on the page: the keep waits for its refetch. */
const QueryHarness = ({
    row,
    load,
}: {
    row: QuestionRow;
    load: () => Promise<SubmissionOutline>;
}) => {
    const { data } = useQuery({ queryKey: submissionKeys.outline('att-1'), queryFn: load });
    const keep = useKeepKeyword(data);
    if (!data) return null;
    return <KeepKeywordButton row={row} onKeep={keep.keep} busy={keep.keepingKey === row.key} />;
};

const renderKeep = (o: SubmissionOutline, row: QuestionRow) =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <Harness o={o} row={row} />
        </QueryClientProvider>
    );

beforeAll(async () => {
    await setupTestI18n();
});
beforeEach(() => {
    api.editMarks.mockReset().mockResolvedValue({});
    toast.success.mockReset();
    toast.error.mockReset();
});

describe('keyword-match suggestion: "Keep X / Y"', () => {
    it('is offered before release only, when the teacher can edit, on keyword rows only', () => {
        expect(canKeepKeyword(kw(2), outline())).toBe(true);
        expect(
            canKeepKeyword(
                kw(2),
                outline({ release: release({ status: 'RELEASED', token: 'RELEASED|1' }) })
            )
        ).toBe(false);
        expect(
            canKeepKeyword(
                kw(2),
                outline({ permissions: { ...outline().permissions, can_edit: false } })
            )
        ).toBe(false);
        expect(canKeepKeyword(qrow({ key: 's1:q1', marks: 2 }), outline())).toBe(false);
        expect(
            canKeepKeyword(
                qrow({ key: 's1:q1', state: 'MARKED', marked_by_kind: 'KEYWORD' }),
                outline()
            )
        ).toBe(false);
    });

    it('sends a teacher edit of the same mark with the revision and release token on screen', async () => {
        renderKeep(outline(), kw(2.5));
        expect(screen.getByTestId('keyword-suggested')).toHaveTextContent(
            'Keyword match suggested 2.5 / 5'
        );
        fireEvent.click(screen.getByRole('button', { name: 'Keep 2.5 / 5' }));
        await waitFor(() =>
            expect(api.editMarks).toHaveBeenCalledWith('att-1', 's1', 'q4', {
                marks: 2.5,
                expected_revision: 7,
                expected_release: 'PENDING|0',
            })
        );
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Q4 marked 2.5 / 5'));
    });

    it('a negative keyword score says "Use 0" and sends 0', async () => {
        renderKeep(outline(), kw(-1));
        fireEvent.click(screen.getByRole('button', { name: 'Use 0' }));
        await waitFor(() =>
            expect(api.editMarks).toHaveBeenCalledWith(
                'att-1',
                's1',
                'q4',
                expect.objectContaining({ marks: 0 })
            )
        );
    });

    it('refreshes the attempt that was kept when the teacher moved to another learner meanwhile', async () => {
        const pending = deferred<object>();
        api.editMarks.mockReturnValue(pending.promise);
        const client = new QueryClient();
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        const onKept = vi.fn();
        const learnerB = outline({ attempt_id: 'att-2', assessment_id: 'asmt-1' });
        const { rerender } = render(
            <QueryClientProvider client={client}>
                <SwitchHarness o={outline()} row={kw(2)} onKept={onKept} />
            </QueryClientProvider>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Keep 2 / 5' }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Keep 2 / 5' })).toBeDisabled()
        );

        rerender(
            <QueryClientProvider client={client}>
                <SwitchHarness o={learnerB} row={kw(2)} onKept={onKept} />
            </QueryClientProvider>
        );
        // Learner B's same question is not busy.
        expect(screen.getByRole('button', { name: 'Keep 2 / 5' })).toBeEnabled();

        pending.resolve({});
        await waitFor(() => expect(onKept).toHaveBeenCalledWith('att-1'));
        const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
        expect(keys).toContain(JSON.stringify(['SUBMISSION_REVIEW', 'att-1']));
        expect(keys.some((k) => k.includes('att-2'))).toBe(false);
    });

    it('stays busy until the outline is refetched, so the stale button cannot be clicked again', async () => {
        const refetch = deferred<SubmissionOutline>();
        const load = vi.fn().mockResolvedValueOnce(outline()).mockReturnValueOnce(refetch.promise);
        render(
            <QueryClientProvider client={new QueryClient()}>
                <QueryHarness row={kw(2)} load={load} />
            </QueryClientProvider>
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Keep 2 / 5' }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Q4 marked 2 / 5'));
        await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
        expect(screen.getByRole('button', { name: 'Keep 2 / 5' })).toBeDisabled();

        refetch.resolve(outline());
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Keep 2 / 5' })).toBeEnabled()
        );
        expect(api.editMarks).toHaveBeenCalledTimes(1);
    });

    it('a 409 says the answer changed and refreshes', async () => {
        api.editMarks.mockRejectedValue({
            response: { data: { code: 'STALE_REVISION', message: '' } },
        });
        renderKeep(outline(), kw(2));
        fireEvent.click(screen.getByRole('button', { name: 'Keep 2 / 5' }));
        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(
                'This answer changed a moment ago. The page is refreshed.'
            )
        );
    });
});
