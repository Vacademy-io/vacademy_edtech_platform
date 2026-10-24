import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PaperDigitiseReviewDialog } from '../paper-digitise-review-dialog';
import type { DigitisedPaper } from '@/services/paper-digitise';
import { EMPTY_COPY_CHECK_SETTINGS } from '@/components/common/ai-copy-check/CopyCheckSettingsFields';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts ? `${key} ${JSON.stringify(opts)}` : key,
    }),
}));

const RUBRIC = JSON.stringify({
    max_marks: 3,
    rubric: [
        { criteria_name: 'Content', max_marks: 2, evaluation_guidelines: 'points' },
        { criteria_name: 'Expression', max_marks: 1, evaluation_guidelines: 'language' },
    ],
});

const paper = (): DigitisedPaper => ({
    title: 'Literature',
    total_marks: 4,
    duration_minutes: null,
    sections: [],
    questions: [
        {
            question_type: 'LONG_ANSWER',
            text: { type: 'HTML', content: '<p>How was bread important?</p>' },
            evaluation_criteria_json: RUBRIC,
        },
        { question_type: 'ONE_WORD', text: { type: 'HTML', content: '<p>Fill in</p>' } },
    ],
    raw_questions: [
        { question_number: '1', marks: 3, marks_source: 'printed' },
        { question_number: '2', marks: 1, marks_source: 'printed' },
    ],
    warnings: [],
    pages: 1,
    file_name: 'lit.pdf',
    estimate: {
        tool_key: 'paper_digitise',
        estimated_credits: 1,
        current_balance: 10,
        balance_after: 9,
        sufficient: true,
        breakdown: [],
    },
    credits_charged: 1,
    balance_after: 9,
    billed: true,
});

const render_ = (withSettings: boolean) => {
    const onConfirm = vi.fn();
    render(
        <PaperDigitiseReviewDialog
            open
            paper={paper()}
            expectedTotal={4}
            busy={false}
            onConfirm={onConfirm}
            onCreateWithoutAi={vi.fn()}
            onClose={vi.fn()}
            {...(withSettings
                ? { aiSettings: EMPTY_COPY_CHECK_SETTINGS, onAiSettingsChange: vi.fn() }
                : {})}
        />
    );
    return { onConfirm };
};

describe('PaperDigitiseReviewDialog - evaluation criteria', () => {
    it("shows each question's criteria, or that the AI will write them", () => {
        render_(false);
        expect(screen.getByText('Content (2) · Expression (1)')).toBeTruthy();
        expect(screen.getAllByText('review.criteria.none')).toHaveLength(1);
        expect(screen.getAllByText('review.criteria.edit')).toHaveLength(2);
    });

    it('shows the AI checking settings only when they are passed', () => {
        render_(false);
        expect(screen.queryByText('review.ai.title')).toBeNull();
    });

    it('renders the AI checking settings when given', () => {
        render_(true);
        expect(screen.getByText('review.ai.title')).toBeTruthy();
    });

    it('leaves criteria out of the confirmed questions when nobody edited them', () => {
        const { onConfirm } = render_(false);
        fireEvent.click(screen.getByText(/review\.createWithQuestions/));
        expect(onConfirm).toHaveBeenCalledWith([
            { index: 0, marks: 3 },
            { index: 1, marks: 1 },
        ]);
    });
});
