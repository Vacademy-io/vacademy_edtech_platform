import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionLibraryPage } from './QuestionLibraryPage';

const state = vi.hoisted(() => ({
    tree: undefined as unknown,
    questions: [] as unknown[],
    papers: [] as unknown[],
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

vi.mock('@/stores/layout-container/useNavHeadingStore', () => ({
    useNavHeadingStore: () => ({ setNavHeading: () => undefined }),
}));

vi.mock('@/lib/sanitize-html', () => ({ sanitizeRichHtml: (html: string) => html }));

vi.mock('@/lib/latex-delimiters', () => ({ renderLatexDelimiters: (html: string) => html }));

vi.mock('./TopicDialogs', () => ({
    DeleteTopicDialog: () => null,
    MoveTopicDialog: () => null,
    TopicFormDialog: () => null,
    TopicPickerDialog: () => null,
}));

vi.mock('./ImportDialogs', () => ({
    AddPaperToTopicDialog: () => null,
    ImportTagsDialog: () => null,
}));

vi.mock('./LibraryQuestionEditDialog', () => ({ LibraryQuestionEditDialog: () => null }));

vi.mock('../-services/question-library-services', async (original) => {
    const actual = await original<Record<string, unknown>>();
    return {
        ...actual,
        useLibraryTree: () => ({
            data: state.tree,
            isLoading: false,
            isError: false,
            refetch: () => undefined,
        }),
        useLibraryQuestions: () => ({
            data: {
                content: state.questions,
                total_elements: state.questions.length,
                total_pages: 1,
            },
            isLoading: false,
            isError: false,
            isFetching: false,
            refetch: () => undefined,
        }),
        useLibraryPapers: () => ({
            data: state.papers,
            isLoading: false,
            isError: false,
            refetch: () => undefined,
        }),
        useLibraryRefresh: () => () => undefined,
    };
});

const summary = (total: number) => ({
    total_questions: total,
    unsorted_questions: 0,
    added_last_week: 0,
    topic_count: total ? 1 : 0,
    by_difficulty: {},
    by_type: {},
});

const topic = {
    id: 'chem',
    parent_id: null,
    name: 'Chemical Reactions',
    display_order: 0,
    depth: 1,
    question_count: 1,
    easy_count: 1,
    medium_count: 0,
    hard_count: 0,
};

const question = {
    question: { id: 'q1', question_type: 'MCQS', text: { content: 'What is rust?' }, options: [] },
    node_ids: ['chem'],
    assessment_count: 0,
};

describe('QuestionLibraryPage', () => {
    beforeEach(() => {
        state.questions = [];
        state.papers = [];
    });

    it('shows one message, no zero stats or filters, when a reader finds the library empty', () => {
        state.tree = { nodes: [], summary: summary(0), max_depth: 4, can_manage: false };

        render(<QuestionLibraryPage />);

        expect(screen.getByText('comingSoon.title')).toBeTruthy();
        expect(screen.queryByText('stats.questions')).toBeNull();
        expect(screen.queryByPlaceholderText('filters.search')).toBeNull();
    });

    it('lets a reader browse a filled library but offers nothing that changes it', () => {
        state.tree = { nodes: [topic], summary: summary(1), max_depth: 4, can_manage: false };
        state.questions = [question];
        state.papers = [{ id: 'p1', title: 'Chapter Test', node_id: 'chem', question_count: 30 }];

        render(<QuestionLibraryPage />);

        expect(screen.getByText('What is rust?')).toBeTruthy();
        expect(screen.getByText('Chapter Test')).toBeTruthy();
        expect(screen.getByPlaceholderText('filters.search')).toBeTruthy();
        for (const write of [
            'header.newTopic',
            'header.importPaper',
            'tree.addTopic',
            'tree.unsorted',
            'bulk.selectPage',
        ]) {
            expect(screen.queryByText(write)).toBeNull();
        }
        expect(screen.queryByLabelText('list.edit')).toBeNull();
        expect(screen.queryByLabelText('papers.remove')).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('gives the owner institute its write actions', () => {
        state.tree = { nodes: [topic], summary: summary(1), max_depth: 4, can_manage: true };
        state.questions = [question];

        render(<QuestionLibraryPage />);

        expect(screen.getByText('header.newTopic')).toBeTruthy();
        expect(screen.getByText('tree.addTopic')).toBeTruthy();
        expect(screen.getByLabelText('list.edit')).toBeTruthy();
    });

    it('keeps the owner on the full page even with no topics yet', () => {
        state.tree = { nodes: [], summary: summary(0), max_depth: 4, can_manage: true };

        render(<QuestionLibraryPage />);

        expect(screen.queryByText('comingSoon.title')).toBeNull();
        expect(screen.getByText('header.newTopic')).toBeTruthy();
    });
});
