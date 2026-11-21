import { describe, expect, it } from 'vitest';
import {
    computeToolCredits,
    typedPerAnswerCredits,
    type ToolPricingRow,
} from '@/services/ai-credits/get-ai-credits';

// The live copy_check_evaluation row prices pages, with a separate per-answer rate
// for a typed (online) attempt in params.typed_per_answer.
const copyCheckRow: ToolPricingRow = {
    tool_key: 'copy_check_evaluation',
    request_type: 'evaluation',
    flat_base_credits: 0,
    per_unit_credits: 1,
    unit_field: 'pages',
    params: { fixed_price: true, typed_per_answer: 1.5 },
};

describe('computeToolCredits for typed answers', () => {
    it('prices a typed attempt per answer, not per page, as ai_service does', () => {
        expect(computeToolCredits(copyCheckRow, { answer_mode: 'TYPED', num_answers: 3 })).toBe(5);
        expect(computeToolCredits(copyCheckRow, { num_pages: 3 })).toBe(3);
    });

    it('reads the per-answer rate, not the per-page one', () => {
        expect(typedPerAnswerCredits(copyCheckRow)).toBe(1.5);
        expect(typedPerAnswerCredits({ ...copyCheckRow, params: {} })).toBeNull();
        expect(typedPerAnswerCredits(null)).toBeNull();
    });

    it('falls back to the row unit when the row has no typed rate', () => {
        const pagesOnly = { ...copyCheckRow, params: {} };
        expect(computeToolCredits(pagesOnly, { answer_mode: 'TYPED', num_answers: 3 })).toBe(0);
    });
});
