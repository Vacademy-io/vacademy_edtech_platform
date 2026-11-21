/**
 * "From Question Bank / Paper" on a quiz slide: the questions picked from a saved paper
 * must arrive as NEW quiz questions (no assessment-service ids), and types a quiz cannot
 * hold are left out. The paper list itself is the shared QuestionPapersTabs, mocked here
 * so the test drives only what this dialog adds on top of it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { MyQuestion } from '@/types/assessments/question-paper-form';

type Picked = (questions: MyQuestion[], options: { chooseManually: boolean }) => void;
let pickedQuestions: MyQuestion[] = [];
let chooseManually = false;

vi.mock('@/routes/assessment/question-papers/-components/QuestionPapersTabs', () => ({
    QuestionPapersTabs: ({ onQuestionsPicked }: { onQuestionsPicked: Picked }) => (
        <button
            type="button"
            onClick={() => onQuestionsPicked(pickedQuestions, { chooseManually })}
        >
            pick-paper
        </button>
    ),
}));

vi.mock('@/routes/assessment/question-papers/-components/QuestionSelectorDialog', () => ({
    default: ({
        open,
        questions,
        onConfirm,
    }: {
        open: boolean;
        questions: MyQuestion[];
        onConfirm: (selected: MyQuestion[]) => void;
    }) =>
        open ? (
            <button type="button" onClick={() => onConfirm(questions.slice(0, 1))}>
                {`confirm-first-of-${questions.length}`}
            </button>
        ) : null,
}));

const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
    toast: {
        warning: (...a: unknown[]) => toastWarning(...a),
        error: (...a: unknown[]) => toastError(...a),
    },
}));

const { default: QuizAddViaQuestionPaperDialog } = await import('../QuizAddViaQuestionPaperDialog');

const option = (id: string, name: string, isSelected: boolean) => ({ id, name, isSelected });

const paperQuestion = (overrides: Partial<MyQuestion>): MyQuestion => ({
    id: 'paper-q-1',
    questionId: 'paper-q-1',
    questionName: '<p>2 + 2 = ?</p>',
    explanation: '<p>Because.</p>',
    questionType: 'MCQS',
    questionMark: '4',
    questionPenalty: '',
    questionDuration: { hrs: '0', min: '0' },
    singleChoiceOptions: [option('opt-a', '3', false), option('opt-b', '4', true)],
    multipleChoiceOptions: [],
    csingleChoiceOptions: [],
    cmultipleChoiceOptions: [],
    trueFalseOptions: [],
    status: 'ACTIVE',
    ...overrides,
});

const renderDialog = () => {
    const onQuestionsReady = vi.fn();
    const onOpenChange = vi.fn();
    render(
        <QuizAddViaQuestionPaperDialog
            open
            onOpenChange={onOpenChange}
            onQuestionsReady={onQuestionsReady}
        />
    );
    return { onQuestionsReady, onOpenChange };
};

afterEach(() => {
    cleanup();
    pickedQuestions = [];
    chooseManually = false;
    toastWarning.mockReset();
    toastError.mockReset();
});

describe('QuizAddViaQuestionPaperDialog', () => {
    it('hands over picked questions as new quiz questions, with every paper id dropped', () => {
        pickedQuestions = [paperQuestion({})];
        const { onQuestionsReady, onOpenChange } = renderDialog();

        fireEvent.click(screen.getByText('pick-paper'));

        expect(onOpenChange).toHaveBeenCalledWith(false);
        const [questions] = onQuestionsReady.mock.calls[0]!;
        expect(questions).toHaveLength(1);
        const q = questions[0];
        expect(q.id).toBe('');
        expect(q.questionId).toBeUndefined();
        expect(q.newQuestion).toBe(true);
        // Content and the correct answer survive; only the ids go.
        expect(q.questionName).toBe('<p>2 + 2 = ?</p>');
        expect(q.explanation).toBe('<p>Because.</p>');
        expect(q.singleChoiceOptions).toEqual([option('', '3', false), option('', '4', true)]);
    });

    it('leaves out question types a quiz cannot hold and says how many', () => {
        pickedQuestions = [
            paperQuestion({ id: 'a', questionId: 'a' }),
            paperQuestion({ id: 'b', questionId: 'b', questionType: 'CODING' }),
        ];
        const { onQuestionsReady } = renderDialog();

        fireEvent.click(screen.getByText('pick-paper'));

        expect(onQuestionsReady.mock.calls[0]![0]).toHaveLength(1);
        expect(toastWarning).toHaveBeenCalledTimes(1);
    });

    it('marks a Spreadsheet & Written Response question as owning its solution', () => {
        pickedQuestions = [
            paperQuestion({ questionType: 'CBE_RESPONSE', singleChoiceOptions: [] }),
        ];
        const { onQuestionsReady } = renderDialog();

        fireEvent.click(screen.getByText('pick-paper'));

        expect(onQuestionsReady.mock.calls[0]![0][0].cbeSecretStatus).toBe('owned');
    });

    it('Manual: opens the question selector and adds only what was chosen there', () => {
        pickedQuestions = [
            paperQuestion({ id: 'a', questionId: 'a' }),
            paperQuestion({ id: 'b', questionId: 'b' }),
            paperQuestion({ id: 'c', questionId: 'c', questionType: 'CODING' }),
        ];
        chooseManually = true;
        const { onQuestionsReady } = renderDialog();

        fireEvent.click(screen.getByText('pick-paper'));
        expect(onQuestionsReady).not.toHaveBeenCalled();

        // The selector only lists the 2 questions a quiz can hold.
        fireEvent.click(screen.getByText('confirm-first-of-2'));
        const [questions] = onQuestionsReady.mock.calls[0]!;
        expect(questions).toHaveLength(1);
        expect(questions[0].id).toBe('');
    });

    it('an empty paper adds nothing and says so', () => {
        pickedQuestions = [];
        const { onQuestionsReady } = renderDialog();

        fireEvent.click(screen.getByText('pick-paper'));

        expect(onQuestionsReady).not.toHaveBeenCalled();
        expect(toastError).toHaveBeenCalledTimes(1);
    });
});
