/**
 * Step 2 "Upload CSV / Excel": the sheet dialog, then the review-and-save
 * dialog. The review dialog is stubbed — it is the existing question-paper
 * dialog, covered elsewhere — but it behaves like the real one where this flow
 * depends on it: it mirrors the questions into the section on open, and on
 * save writes the saved questions and calls onSaved.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { useEffect } from 'react';

type StubProps = {
    index: number;
    sectionsForm: { setValue: (name: string, value: unknown) => void };
    initialQuestions?: Array<{ questionId?: string; questionName: string; questionType: string }>;
    onSaved?: () => void;
};

vi.mock('@/routes/assessment/question-papers/-components/QuestionPaperUpload', () => ({
    QuestionPaperUpload: ({ index, sectionsForm, initialQuestions = [], onSaved }: StubProps) => {
        useEffect(() => {
            // The real dialog mirrors the questions into the section while reviewing.
            sectionsForm.setValue(
                `section.${index}.adaptive_marking_for_each_question`,
                initialQuestions.map((q) => ({
                    questionName: q.questionName,
                    questionType: q.questionType,
                }))
            );
        }, []); // eslint-disable-line react-hooks/exhaustive-deps
        return (
            <div data-testid="review">
                <span data-testid="review-ids">
                    {initialQuestions.map((q) => q.questionId).join(',')}
                </span>
                <span data-testid="review-types">
                    {initialQuestions.map((q) => q.questionType).join(',')}
                </span>
                <button
                    type="button"
                    onClick={() => {
                        sectionsForm.setValue(
                            `section.${index}.adaptive_marking_for_each_question`,
                            initialQuestions.map((q, i) => ({
                                questionId: `saved-${i}`,
                                questionName: q.questionName,
                            }))
                        );
                        onSaved?.();
                    }}
                >
                    stub-save
                </button>
            </div>
        );
    },
}));

import Step2UploadFromSheet from '../Step2UploadFromSheet';

const HEADER =
    'question_text,question_type,option_a,option_b,option_c,option_d,correct_answer,explanation';
const GOOD = [
    'What is 2 + 2?,MCQS,1,2,4,8,C,Four.',
    'Which of these are prime numbers?,MCQM,2,3,4,6,"A,B",Two and three.',
    'Is the Earth flat?,TRUE_FALSE,True,False,,,B,No.',
];

// Only read back in the assertions.
let formRef: { getValues: (name: string) => unknown } | null = null;
const EXISTING = [
    { questionId: 'q-old', questionName: 'Already in the section', questionType: 'MCQS' },
];

const Harness = () => {
    const form = useForm({
        defaultValues: {
            section: [{ adaptive_marking_for_each_question: EXISTING, total_marks: '1' }],
        },
    });
    formRef = form as unknown as { getValues: (name: string) => unknown };
    return (
        <Step2UploadFromSheet
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            form={form as any}
            index={0}
            examType="EXAM"
            currentQuestionIndex={0}
            setCurrentQuestionIndex={() => {}}
        />
    );
};

const sectionQuestions = () =>
    formRef!.getValues('section.0.adaptive_marking_for_each_question') as Array<{
        questionId?: string;
    }>;

const uploadSheet = (rows: string[]) => {
    render(<Harness />);
    fireEvent.click(screen.getByText('uploadSection.csvCard.title'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
        target: {
            files: [new File([[HEADER, ...rows].join('\n')], 's.csv', { type: 'text/csv' })],
        },
    });
    fireEvent.click(screen.getByRole('button', { name: /parseAndPreview|Parse & Preview/i }));
};

afterEach(() => {
    cleanup();
    formRef = null;
});

describe('Step 2 — Upload CSV / Excel', () => {
    it('opens the review with every question, numbered, when the sheet is clean', async () => {
        uploadSheet(GOOD);
        const review = await screen.findByTestId('review');
        expect(within(review).getByTestId('review-ids').textContent).toBe('1,2,3');
        expect(within(review).getByTestId('review-types').textContent).toBe('MCQS,MCQM,TRUE_FALSE');
    });

    it('shows the skipped rows first and reviews the good ones once the sheet dialog is closed', async () => {
        uploadSheet([...GOOD, 'A broken row,MCQS,only one,,,,A,']);
        await waitFor(() => expect(document.body.textContent).toMatch(/parseErrorsHeading|error/i));
        expect(screen.queryByTestId('review')).toBeNull();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        const review = await screen.findByTestId('review');
        expect(within(review).getByTestId('review-ids').textContent).toBe('1,2,3');
    });

    it('puts the section back when the review is closed without saving', async () => {
        uploadSheet(GOOD);
        await screen.findByTestId('review');
        expect(sectionQuestions()).toHaveLength(3); // mirrored while reviewing
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByTestId('review')).toBeNull());
        expect(sectionQuestions()).toEqual(EXISTING);
        expect(formRef!.getValues('section.0.total_marks')).toBe('1');
    });

    it('keeps the saved questions when the paper is saved', async () => {
        uploadSheet(GOOD);
        fireEvent.click(await screen.findByText('stub-save'));
        await waitFor(() => expect(screen.queryByTestId('review')).toBeNull());
        expect(sectionQuestions().map((q) => q.questionId)).toEqual([
            'saved-0',
            'saved-1',
            'saved-2',
        ]);
    });
});
