import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseFormReturn } from 'react-hook-form';
import Step2PickFromQuestionLibrary from './Step2PickFromQuestionLibrary';

const api = vi.hoisted(() => ({
    fetchLibraryQuestions: vi.fn(),
    randomPickLibraryQuestions: vi.fn(),
    copyLibraryQuestions: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

vi.mock('@/lib/sanitize-html', () => ({ sanitizeRichHtml: (html: string) => html }));

vi.mock('@/lib/latex-delimiters', () => ({ renderLatexDelimiters: (html: string) => html }));

vi.mock('../../../-utils/helper', () => ({ calculateTotalMarks: () => 0 }));

const node = (id: string, parent: string | null, name: string, depth: number, count: number) => ({
    id,
    parent_id: parent,
    name,
    display_order: 0,
    depth,
    question_count: count,
    easy_count: 0,
    medium_count: count,
    hard_count: 0,
});

const NODES = [
    node('ncert', null, 'NCERT', 1, 20),
    node('chem', 'ncert', 'Chemical Reactions', 2, 10),
    node('life', 'ncert', 'Life Processes', 2, 10),
];

const row = (id: string, text: string) => ({
    question: { id, question_type: 'MCQS', text: { content: text }, options: [] },
    node_ids: ['chem'],
    assessment_count: 0,
});

vi.mock(
    '@/routes/assessment/question-library/-services/question-library-services',
    async (original) => {
        const actual = await original<Record<string, unknown>>();
        const query = (data: unknown) => ({
            data,
            isLoading: false,
            isError: false,
            refetch: () => undefined,
        });
        return {
            ...actual,
            ...api,
            useLibraryTree: (id?: string) =>
                query(
                    id ? { nodes: NODES, summary: {}, max_depth: 4, can_manage: false } : undefined
                ),
            useLibraryQuestions: () =>
                query({
                    content: [row('q1', 'Page one question')],
                    total_elements: 2,
                    total_pages: 2,
                }),
            useLibraryPapers: () => query([]),
            useLibraryAvailability: () =>
                query({ available: { EASY: 8, MEDIUM: 3, HARD: 0 }, questions: [] }),
        };
    }
);

const makeForm = () => {
    const setValue = vi.fn();
    const form = {
        getValues: (path: string) =>
            path.endsWith('.adaptive_marking_for_each_question') ? [] : undefined,
        setValue,
        trigger: vi.fn(),
    } as unknown as UseFormReturn<never>;
    return { form, setValue };
};

const openPicker = () => {
    const { form, setValue } = makeForm();
    render(<Step2PickFromQuestionLibrary form={form} index={0} />);
    fireEvent.click(screen.getByText('pick.cardTitle'));
    return { setValue };
};

describe('Step2PickFromQuestionLibrary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.copyLibraryQuestions.mockResolvedValue({
            copied: [
                {
                    source_question_id: 'q1',
                    question_id: 'copy-1',
                    question_type: 'MCQS',
                    text: 'x',
                },
            ],
            already_in_section: 0,
            failed: 0,
        });
    });

    it('lists topics as folders and finds one by search', () => {
        openPicker();

        expect(screen.getByText('Life Processes')).toBeTruthy();
        fireEvent.change(screen.getByPlaceholderText('picker.search'), {
            target: { value: 'chem' },
        });

        expect(screen.getByText('Chemical Reactions')).toBeTruthy();
        expect(screen.queryByText('Life Processes')).toBeNull();
    });

    it('selects every matching question across pages, not only the visible one', async () => {
        api.fetchLibraryQuestions.mockResolvedValue({ content: [row('q1', 'a'), row('q2', 'b')] });
        openPicker();

        fireEvent.click(screen.getByText('pick.selectAll'));
        await waitFor(() => expect(screen.getByText('pick.addQuestions')).toBeTruthy());
        fireEvent.click(screen.getByText('pick.addQuestions'));

        await waitFor(() => expect(api.copyLibraryQuestions).toHaveBeenCalledTimes(1));
        const body = api.copyLibraryQuestions.mock.calls[0]![1];
        expect(body.question_ids).toEqual(['q1', 'q2']);
    });

    it('picks at random per difficulty, shows the result, and copies only on add', async () => {
        api.randomPickLibraryQuestions.mockResolvedValue({
            available: { EASY: 8, MEDIUM: 3, HARD: 0 },
            questions: [row('r1', 'Random easy question'), row('r2', 'Random medium question')],
        });
        const { setValue } = openPicker();

        fireEvent.click(screen.getByText('pick.random'));
        fireEvent.click(screen.getByText('pick.pickNow'));

        await waitFor(() => expect(screen.getByText('Random easy question')).toBeTruthy());
        expect(api.randomPickLibraryQuestions.mock.calls[0]![1]).toMatchObject({
            library_node_ids: ['ncert', 'chem', 'life'],
            easy: 5,
            medium: 5,
            hard: 5,
        });
        expect(api.copyLibraryQuestions).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('pick.addQuestions'));

        await waitFor(() => expect(api.copyLibraryQuestions).toHaveBeenCalledTimes(1));
        expect(api.copyLibraryQuestions.mock.calls[0]![1].question_ids).toEqual(['r1', 'r2']);
        await waitFor(() => expect(setValue).toHaveBeenCalled());
        const rows = setValue.mock.calls[0]![1] as Array<{
            questionId: string;
            libraryCopy: boolean;
        }>;
        expect(rows[0]).toMatchObject({ questionId: 'copy-1', libraryCopy: true });
    });

    it('does not offer a level with nothing available', () => {
        openPicker();

        fireEvent.click(screen.getByText('pick.random'));

        const hard = screen.getByLabelText('difficulty.HARD') as HTMLInputElement;
        expect(hard.disabled).toBe(true);
    });
});
