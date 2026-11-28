import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionLibraryPage } from './QuestionLibraryPage';

const state = vi.hoisted(() => ({
    tree: undefined as unknown,
    questions: [] as unknown[],
    papers: [] as unknown[],
    tags: [] as unknown[],
    facets: undefined as unknown,
    lastFilters: undefined as Record<string, unknown> | undefined,
    lastScope: undefined as string | null | undefined,
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

vi.mock('./AddQuestionsDialog', () => ({
    AddQuestionsDialog: () => <div>add-questions-dialog</div>,
}));

vi.mock('./ImportExcelDialog', () => ({
    ImportExcelDialog: () => <div>import-excel-dialog</div>,
}));

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
        useLibraryQuestions: (_institute: string, filters: Record<string, unknown>) => {
            state.lastFilters = filters;
            return {
                data: {
                    content: state.questions,
                    total_elements: state.questions.length,
                    total_pages: 1,
                },
                isLoading: false,
                isError: false,
                isFetching: false,
                refetch: () => undefined,
            };
        },
        useLibraryTags: () => ({ data: state.tags, isLoading: false, isError: false }),
        useLibraryFacets: (
            _institute: string,
            _filters: Record<string, unknown>,
            scope: string | null
        ) => {
            state.lastScope = scope;
            return {
                data: state.facets,
                isLoading: false,
                isError: false,
                refetch: () => undefined,
            };
        },
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
        state.tags = [];
        state.facets = undefined;
        state.lastFilters = undefined;
        state.lastScope = undefined;
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
            'browse.addCourse',
            'browse.noInstitutes',
            'header.importExcel',
            'browse.addQuestions',
            'bulk.selectPage',
            'manageTags.button',
            'autoTag.button',
        ]) {
            expect(screen.queryByText(write)).toBeNull();
        }
        expect(screen.queryByLabelText('list.edit')).toBeNull();
        expect(screen.queryByLabelText('papers.remove')).toBeNull();
        expect(screen.queryByLabelText('list.select')).toBeNull();
        // The filter panel is for everyone.
        expect(screen.getByText('facets.title')).toBeTruthy();
    });

    it('gives the owner institute its write actions', () => {
        state.tree = { nodes: [topic], summary: summary(1), max_depth: 4, can_manage: true };
        state.questions = [question];

        render(<QuestionLibraryPage />);

        expect(screen.getByText('header.newTopic')).toBeTruthy();
        expect(screen.getByText('browse.addCourse')).toBeTruthy();
        expect(screen.getByText('browse.noInstitutes')).toBeTruthy();
        expect(screen.getByLabelText('list.edit')).toBeTruthy();
    });

    it('keeps the owner on the full page even with no topics yet', () => {
        state.tree = { nodes: [], summary: summary(0), max_depth: 4, can_manage: true };

        render(<QuestionLibraryPage />);

        expect(screen.queryByText('comingSoon.title')).toBeNull();
        expect(screen.getByText('header.newTopic')).toBeTruthy();
    });

    it('opens a course card, shows where you are and lists only that course', () => {
        const polity = { ...topic, id: 'polity', parent_id: 'upsc', name: 'Polity', depth: 2 };
        const upsc = { ...topic, id: 'upsc', name: 'UPSC', question_count: 3 };
        state.tree = {
            nodes: [upsc, polity],
            summary: summary(3),
            max_depth: 5,
            can_manage: false,
        };

        render(<QuestionLibraryPage />);

        // Course cards at the top, and the same courses as the first filter group.
        expect(screen.getAllByText('browse.courses')).toHaveLength(2);
        expect(state.lastFilters?.library_node_ids).toBeUndefined();
        expect(state.lastScope).toBeNull();
        fireEvent.click(screen.getAllByText('UPSC')[0]!);

        // Inside a course the list leads: its topics are a filter, their cards open on demand.
        expect(screen.queryByText('browse.insideTopic')).toBeNull();
        expect(screen.getByText('facets.inside')).toBeTruthy();
        expect(screen.getByText('Polity')).toBeTruthy();
        expect(screen.getByText('browse.allCourses')).toBeTruthy();
        expect(state.lastFilters?.library_node_ids).toEqual(['upsc']);
        expect(state.lastScope).toBe('upsc');
        fireEvent.click(screen.getByText('browse.subtopicCards'));
        expect(screen.getByText('browse.insideTopic')).toBeTruthy();

        fireEvent.click(screen.getByText('browse.allCourses'));
        expect(state.lastFilters?.library_node_ids).toBeUndefined();
    });

    it('opens a topic from the filter panel', () => {
        const polity = { ...topic, id: 'polity', parent_id: 'upsc', name: 'Polity', depth: 2 };
        const upsc = { ...topic, id: 'upsc', name: 'UPSC', question_count: 3 };
        state.tree = {
            nodes: [upsc, polity],
            summary: summary(3),
            max_depth: 5,
            can_manage: false,
        };

        render(<QuestionLibraryPage />);
        fireEvent.click(screen.getByLabelText('facets.openTopic'));

        expect(state.lastFilters?.library_node_ids).toEqual(['upsc']);
        expect(state.lastScope).toBe('upsc');
    });

    it('ticks many values: any inside a group, every group, and topics inside the open one', () => {
        const polity = { ...topic, id: 'polity', parent_id: 'upsc', name: 'Polity', depth: 2 };
        const history = { ...topic, id: 'history', parent_id: 'upsc', name: 'History', depth: 2 };
        const upsc = { ...topic, id: 'upsc', name: 'UPSC', question_count: 3 };
        state.tree = {
            nodes: [upsc, polity, history],
            summary: summary(3),
            max_depth: 5,
            can_manage: false,
        };
        state.questions = [question];
        state.facets = {
            difficulties: { EASY: 4, MEDIUM: 0, HARD: 2 },
            question_types: { MCQS: 6 },
            topics: [
                { id: 'polity', count: 4 },
                { id: 'history', count: 2 },
            ],
            tags: [
                { tag_id: 't1', tag_name: 'Article 21', kind: 'CONCEPT', question_count: 4 },
                { tag_id: 't3', tag_name: 'Article 14', kind: 'CONCEPT', question_count: 1 },
                { tag_id: 't2', tag_name: 'UPSC 2023', kind: 'PYQ', question_count: 2 },
            ],
        };

        render(<QuestionLibraryPage />);
        fireEvent.click(screen.getAllByText('UPSC')[0]!);

        // Counts sit next to each value.
        expect(screen.getByText('tags.kind.CONCEPT')).toBeTruthy();
        expect(screen.getByText('tags.kind.PYQ')).toBeTruthy();

        fireEvent.click(screen.getByText('Article 21'));
        fireEvent.click(screen.getByText('Article 14'));
        fireEvent.click(screen.getByText('UPSC 2023'));
        expect(state.lastFilters?.tag_groups).toEqual({ CONCEPT: ['t1', 't3'], PYQ: ['t2'] });

        fireEvent.click(screen.getByText('difficulty.EASY'));
        fireEvent.click(screen.getByText('difficulty.HARD'));
        expect(state.lastFilters?.difficulties).toEqual(['EASY', 'HARD']);

        fireEvent.click(screen.getByText('Polity'));
        fireEvent.click(screen.getByText('History'));
        expect(state.lastFilters?.library_node_ids).toEqual(['polity', 'history']);

        // A ticked value also shows as a chip above the list; clicking it unticks.
        const chips = screen.getAllByLabelText('facets.remove');
        expect(chips).toHaveLength(7);
        fireEvent.click(chips[0]!);
        expect(state.lastFilters?.library_node_ids).toEqual(['history']);

        fireEvent.click(screen.getAllByText('facets.clearAll')[0]!);
        expect(state.lastFilters?.tag_groups).toBeUndefined();
        expect(state.lastFilters?.difficulties).toBeUndefined();
        expect(state.lastFilters?.library_node_ids).toEqual(['upsc']);
    });

    it('lets the owner import from Excel and add questions inside an open topic', () => {
        state.tree = { nodes: [topic], summary: summary(1), max_depth: 5, can_manage: true };

        render(<QuestionLibraryPage />);

        fireEvent.click(screen.getByText('header.importExcel'));
        expect(screen.getByText('import-excel-dialog')).toBeTruthy();
        // Adding questions needs a topic to put them in.
        expect(screen.queryByText('browse.addQuestions')).toBeNull();

        fireEvent.click(screen.getAllByText('Chemical Reactions')[0]!);
        fireEvent.click(screen.getAllByText('browse.addQuestions')[0]!);
        expect(screen.getByText('add-questions-dialog')).toBeTruthy();
    });
});
