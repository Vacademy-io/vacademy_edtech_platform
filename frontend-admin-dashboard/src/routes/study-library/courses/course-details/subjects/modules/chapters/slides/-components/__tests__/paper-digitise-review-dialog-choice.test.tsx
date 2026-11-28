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

/** One 6-mark question plus "answer any TWO of these three" 3-mark questions: out of 12, not 15. */
const paper = (over: Partial<DigitisedPaper> = {}): DigitisedPaper => ({
    title: 'Literature',
    total_marks: 12,
    duration_minutes: null,
    sections: [],
    questions: ['X', 'IX-1', 'IX-2', 'IX-3'].map((n) => ({
        question_type: 'LONG_ANSWER',
        text: { type: 'HTML', content: `<p>Question ${n}</p>` },
    })),
    raw_questions: [
        { question_number: 'X', marks: 6, marks_source: 'printed', section: 'X' },
        { question_number: '1', marks: 3, marks_source: 'section', section: 'IX' },
        { question_number: '2', marks: 3, marks_source: 'section', section: 'IX' },
        { question_number: '3', marks: 3, marks_source: 'section', section: 'IX' },
    ],
    warnings: [],
    choice_groups: [{ label: 'IX', question_indexes: [1, 2, 3], attempt: 2, policy: 'best' }],
    paper_total: 12,
    pages: 1,
    file_name: 'lit.pdf',
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

const setup = (over: Partial<DigitisedPaper> = {}, expectedTotal: number | null = 12) => {
    const onConfirm = vi.fn();
    render(
        <PaperDigitiseReviewDialog
            open
            paper={paper(over)}
            expectedTotal={expectedTotal}
            busy={false}
            onConfirm={onConfirm}
            onCreateWithoutAi={vi.fn()}
            onClose={vi.fn()}
        />
    );
    return { onConfirm };
};

const primary = () => screen.getByRole('button', { name: /review\.createWithQuestions/ });

describe('PaperDigitiseReviewDialog — internal choice', () => {
    it('totals the paper under its choice and raises no mismatch against the teacher total', () => {
        setup();
        expect(screen.getByText(/review\.totalLine.*"count":4,"total":12/)).toBeInTheDocument();
        expect(screen.getByText(/review\.allQuestionsAddUp.*"total":15/)).toBeInTheDocument();
        expect(screen.queryByText(/review\.youEntered/)).not.toBeInTheDocument();
        expect(screen.getAllByText(/review\.choice\.chip.*"attempt":2,"count":3/)).toHaveLength(3);
    });

    it('hands back the choice with the questions', () => {
        const { onConfirm } = setup();
        fireEvent.click(primary());
        expect(onConfirm).toHaveBeenCalledWith(
            [
                { index: 0, marks: 6 },
                { index: 1, marks: 3 },
                { index: 2, marks: 3 },
                { index: 3, marks: 3 },
            ],
            [{ label: 'IX', indexes: [1, 2, 3], attempt: 2, policy: 'best' }]
        );
    });

    it('lets the teacher change the count and the counting rule', () => {
        const { onConfirm } = setup({}, null);
        const attemptInput = screen.getAllByRole('spinbutton')[0]!; // the choice's "answer any" box comes first
        fireEvent.change(attemptInput, { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'review.choice.policy.first' }));
        expect(screen.getByText(/review\.totalLine.*"total":9/)).toBeInTheDocument();
        fireEvent.click(primary());
        expect(onConfirm.mock.calls[0][1]).toEqual([
            { label: 'IX', indexes: [1, 2, 3], attempt: 1, policy: 'first' },
        ]);
    });

    it('a choice made compulsory, or left with too few questions, is not sent', () => {
        const { onConfirm } = setup({}, null);
        fireEvent.click(screen.getByRole('button', { name: 'review.choice.makeCompulsory' }));
        expect(screen.getByText(/review\.totalLine.*"total":15/)).toBeInTheDocument();
        fireEvent.click(primary());
        expect(onConfirm.mock.calls[0]).toHaveLength(1); // exactly the call a paper without choice makes
    });

    it('removing questions shrinks the choice and drops it when it stops being one', () => {
        const { onConfirm } = setup({}, null);
        const remove = screen.getAllByRole('button', { name: 'review.removeQuestion' });
        fireEvent.click(remove[3]!); // IX-3 gone: any 2 of 2 is no choice
        expect(screen.getByText(/review\.totalLine.*"count":3,"total":12/)).toBeInTheDocument();
        fireEvent.click(primary());
        expect(onConfirm.mock.calls[0]).toHaveLength(1);
    });
});
