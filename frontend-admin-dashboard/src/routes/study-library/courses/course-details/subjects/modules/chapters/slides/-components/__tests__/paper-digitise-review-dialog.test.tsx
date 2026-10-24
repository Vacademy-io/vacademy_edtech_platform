import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PaperDigitiseReviewDialog } from '../paper-digitise-review-dialog';
import type { DigitisedPaper } from '@/services/paper-digitise';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts ? `${key} ${JSON.stringify(opts)}` : key,
    }),
}));

const paper = (over: Partial<DigitisedPaper> = {}): DigitisedPaper => ({
    title: 'Half Yearly Mock',
    total_marks: 10,
    duration_minutes: 60,
    sections: [],
    questions: [
        { question_type: 'MCQS', text: { type: 'HTML', content: '<p>What is <b>2+2</b>?</p>' } },
        { question_type: 'LONG_ANSWER', text: { type: 'HTML', content: '<p>Explain soil.</p>' } },
        { question_type: 'LONG_ANSWER', text: { type: 'HTML', content: '<p>Note: all questions compulsory</p>' } },
    ],
    raw_questions: [
        { question_number: '1', marks: 2, marks_source: 'printed', answer_source: 'model' },
        { question_number: '2', marks: 5, marks_source: 'printed' },
        { question_number: '3', marks: 3, marks_source: 'split' },
    ],
    warnings: ['The paper prints no answer key; the AI suggested answers for 1 objective question(s).'],
    pages: 2,
    file_name: 'mock.pdf',
    estimate: {
        tool_key: 'paper_digitise',
        estimated_credits: 3,
        current_balance: 100,
        balance_after: 97,
        sufficient: true,
        breakdown: [],
    },
    credits_charged: 3,
    balance_after: 97,
    billed: true,
    ...over,
});

const setup = (over: Partial<DigitisedPaper> = {}, expectedTotal: number | null = 10) => {
    const onConfirm = vi.fn();
    const onCreateWithoutAi = vi.fn();
    const onClose = vi.fn();
    render(
        <PaperDigitiseReviewDialog
            open
            paper={paper(over)}
            expectedTotal={expectedTotal}
            busy={false}
            onConfirm={onConfirm}
            onCreateWithoutAi={onCreateWithoutAi}
            onClose={onClose}
        />
    );
    return { onConfirm, onCreateWithoutAi, onClose };
};

const primaryButton = () =>
    screen.getByRole('button', { name: /review\.createWithQuestions/ });

describe('PaperDigitiseReviewDialog', () => {
    it('shows every question with its marks, what was charged, and flags to verify', () => {
        setup();
        // Rendered as HTML now (the <b> stays bold), so the text spans two nodes.
        expect(screen.getByText('2+2').closest('p')).toHaveTextContent('What is 2+2?');
        expect(screen.getByText('Explain soil.')).toBeInTheDocument();
        expect(screen.getByText(/review\.creditsCharged.*"credits":3.*"count":2/)).toBeInTheDocument();
        expect(screen.getByText(/review\.balanceNow.*97/)).toBeInTheDocument();
        expect(screen.getByText('review.aiSuggestedAnswer')).toBeInTheDocument();
        expect(screen.getByText('review.marksGuessed')).toBeInTheDocument();
        expect(screen.getByText(/review\.totalLine.*"count":3,"total":10/)).toBeInTheDocument();
        expect(screen.getByText(/review\.perSheetCost.*"count":3/)).toBeInTheDocument();
        expect(screen.getByText(/AI suggested answers/)).toBeInTheDocument();
    });

    it('marks an objective question that has no answer, but not a written one', () => {
        setup({
            questions: [
                { question_type: 'NUMERIC', text: { type: 'HTML', content: '<p>How many days?</p>' } },
                { question_type: 'LONG_ANSWER', text: { type: 'HTML', content: '<p>Explain.</p>' } },
            ],
            raw_questions: [
                { question_number: '2', marks: 1, marks_source: 'section', answer_source: 'none' },
                { question_number: '7', marks: 3, marks_source: 'printed', answer_source: 'none' },
            ],
            warnings: [],
        });
        expect(screen.getAllByText('review.noAnswer')).toHaveLength(1);
    });

    it('hands back the accepted questions with the marks as edited', () => {
        const { onConfirm } = setup();
        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[1]!, { target: { value: '4' } });
        fireEvent.click(primaryButton());
        expect(onConfirm).toHaveBeenCalledWith([
            { index: 0, marks: 2 },
            { index: 1, marks: 4 },
            { index: 2, marks: 3 },
        ]);
    });

    it('drops a removed question, can restore it, and refuses an empty paper', () => {
        const { onConfirm } = setup();
        const removeButtons = screen.getAllByRole('button', { name: 'review.removeQuestion' });
        fireEvent.click(removeButtons[2]!);
        expect(screen.getByText(/review\.totalLine.*"count":2,"total":7/)).toBeInTheDocument();
        fireEvent.click(primaryButton());
        expect(onConfirm).toHaveBeenCalledWith([
            { index: 0, marks: 2 },
            { index: 1, marks: 5 },
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'review.restore' }));
        expect(screen.getByText(/review\.totalLine.*"count":3,"total":10/)).toBeInTheDocument();

        screen.getAllByRole('button', { name: 'review.removeQuestion' }).forEach((b) => fireEvent.click(b));
        expect(primaryButton()).toBeDisabled();
    });

    it('blocks creation while any kept question has no marks', () => {
        setup();
        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0]!, { target: { value: '0' } });
        expect(primaryButton()).toBeDisabled();
        expect(screen.getByText(/review\.marksRequired.*"count":1/)).toBeInTheDocument();
        fireEvent.change(inputs[0]!, { target: { value: '1.5' } });
        expect(primaryButton()).not.toBeDisabled();
    });

    it('says when the total differs from what the teacher typed, and when billing was not confirmed', () => {
        setup({}, 12);
        expect(screen.getByText(/review\.youEntered.*12/)).toBeInTheDocument();
    });

    it('reports an unconfirmed deduction instead of showing zero', () => {
        setup({ billed: false, credits_charged: null, balance_after: null });
        expect(screen.getByText(/review\.creditsChargedUnknown.*"credits":3/)).toBeInTheDocument();
        expect(screen.queryByText(/review\.balanceNow/)).not.toBeInTheDocument();
    });

    it('typesets a maths question instead of showing its LaTeX source', () => {
        setup({
            questions: [
                {
                    question_type: 'MCQS',
                    text: {
                        type: 'HTML',
                        content: '<p>The linear equation $2 \\mathrm{x}-5 \\mathrm{y}=7$ has:</p>',
                    },
                },
            ],
            raw_questions: [{ question_number: '3', marks: 1, marks_source: 'printed' }],
        });
        expect(screen.queryByText(/\$2 \\mathrm/)).not.toBeInTheDocument();
        expect(document.querySelector('.katex')).not.toBeNull();
        expect(screen.getByText(/The linear equation/)).toBeInTheDocument();
    });

    it('offers the manual path', () => {
        const { onCreateWithoutAi } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'review.createWithoutAi' }));
        expect(onCreateWithoutAi).toHaveBeenCalled();
    });
});
