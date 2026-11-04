import { describe, expect, it } from 'vitest';
import { computeToolCredits, creditHistoryText, perPageCredits } from '../get-ai-credits';
import type { ToolPricingRow } from '../get-ai-credits';

const pageRow: ToolPricingRow = {
    tool_key: 'copy_check_evaluation',
    request_type: 'evaluation',
    flat_base_credits: 0,
    per_unit_credits: 1,
    unit_field: 'pages',
    params: { fixed_price: true, typed_per_answer: 1 },
};

describe('creditHistoryText', () => {
    it('keeps the copy and drops the rate bracket', () => {
        expect(
            creditHistoryText(
                'AI evaluation · Class 9 · Rahul · 6 pages [copy_check_evaluation; rate global]'
            )
        ).toBe('AI evaluation · Class 9 · Rahul · 6 pages');
    });

    it('reads an old copy check charge as AI evaluation, not the model and key', () => {
        expect(
            creditHistoryText(
                'evaluation using z-ai/glm-5.3-flash [copy_check_evaluation; rate global]'
            )
        ).toBe('AI evaluation');
    });

    it('leaves every other charge as it was, and an override rate is still removed', () => {
        expect(creditHistoryText('Recharge of 500 credits')).toBe('Recharge of 500 credits');
        expect(creditHistoryText('content using gpt [ai_course; rate override:ov-1]')).toBe(
            'content using gpt'
        );
        expect(creditHistoryText('A name [with brackets] stays')).toBe('A name [with brackets] stays');
        expect(creditHistoryText(null)).toBe('');
    });
});

describe('copy check rate', () => {
    it('prices the pages from the row', () => {
        expect(computeToolCredits(pageRow, { num_pages: 6 })).toBe(6);
        expect(computeToolCredits({ ...pageRow, per_unit_credits: 2 }, { num_pages: 6 })).toBe(12);
    });

    it('reads the per page rate from the row, and only from a per page row', () => {
        expect(perPageCredits(pageRow)).toBe(1);
        expect(perPageCredits({ ...pageRow, per_unit_credits: 0.5 })).toBe(0.5);
        expect(perPageCredits({ ...pageRow, unit_field: 'questions' })).toBeNull();
        expect(perPageCredits(null)).toBeNull();
    });
});
