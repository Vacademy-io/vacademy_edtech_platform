import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenDecodedData: () => null,
    getTokenFromCookie: () => null,
}));

import { transformSectionsAndQuestionsData } from './helper';
import type { Section } from '@/types/assessments/assessment-steps';
import type { transformSectionsAndQuestionsDataQuestionsData } from './assessment-details-interface';

const longAnswer = (extra: Record<string, unknown>) =>
    ({
        s1: [
            {
                question_id: 'q-1',
                question: { content: '<p>Is the lender a partner?</p>' },
                parent_rich_text: null,
                question_type: 'LONG_ANSWER',
                marking_json: JSON.stringify({
                    type: 'LONG_ANSWER',
                    data: { totalMark: '10', negativeMark: '0' },
                }),
                evaluation_json: JSON.stringify({
                    type: 'LONG_ANSWER',
                    data: { answer: { type: 'HTML', content: '<p>Yes - s.4</p>' } },
                }),
                question_duration: 0,
                options: [],
                options_with_explanation: [],
                ...extra,
            },
        ],
    }) as unknown as transformSectionsAndQuestionsDataQuestionsData;

describe('assessment preview: long answer', () => {
    it('shows the question, the answer key and the explanation', () => {
        const [section] = transformSectionsAndQuestionsData(
            [{ id: 's1', name: 'Section A' } as unknown as Section],
            longAnswer({ explanation: { content: '<p>Provision, application, conclusion</p>' } })
        );
        const question = section?.questions[0] as Record<string, unknown>;
        expect(question.questionName).toBe('<p>Is the lender a partner?</p>');
        expect(question.subjectiveAnswerText).toBe('<p>Yes - s.4</p>');
        expect(question.explanation).toBe('<p>Provision, application, conclusion</p>');
    });

    it('leaves the explanation empty when the server sends none', () => {
        const [section] = transformSectionsAndQuestionsData(
            [{ id: 's1', name: 'Section A' } as unknown as Section],
            longAnswer({})
        );
        expect((section?.questions[0] as Record<string, unknown>).explanation).toBe('');
    });
});
