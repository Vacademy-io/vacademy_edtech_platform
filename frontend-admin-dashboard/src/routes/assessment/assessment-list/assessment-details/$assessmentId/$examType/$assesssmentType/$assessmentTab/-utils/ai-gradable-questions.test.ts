import { describe, expect, it } from 'vitest';
import { countAiGradableQuestions } from './ai-gradable-questions';

const marking = (type: string) => JSON.stringify({ type, data: { totalMark: '5' } });

describe('countAiGradableQuestions', () => {
    it('counts CBE and long-answer questions across sections', () => {
        expect(
            countAiGradableQuestions({
                's-1': [
                    { question_type: 'CBE_RESPONSE', marking_json: marking('CBE_RESPONSE') },
                    { question_type: 'MCQS', marking_json: marking('MCQS') },
                ],
                's-2': [{ question_type: 'LONG_ANSWER', marking_json: marking('LONG_ANSWER') }],
            })
        ).toBe(2);
    });

    it('is 0 for an MCQ-only paper, so the row menu shows no AI item', () => {
        expect(
            countAiGradableQuestions({
                's-1': [
                    { question_type: 'MCQS', marking_json: marking('MCQS') },
                    { question_type: 'NUMERIC', marking_json: marking('NUMERIC') },
                    { question_type: 'ONE_WORD', marking_json: marking('ONE_WORD') },
                ],
            })
        ).toBe(0);
    });

    it('falls back to the marking scheme type when question_type is missing', () => {
        expect(
            countAiGradableQuestions({
                's-1': [{ question_type: null, marking_json: marking('CBE_RESPONSE') }],
            })
        ).toBe(1);
    });

    it('counts a question that sits in two sections once, as the AI grades and bills it', () => {
        expect(
            countAiGradableQuestions({
                's-1': [{ question_id: 'q1', question_type: 'CBE_RESPONSE' }],
                's-2': [
                    { question_id: 'q1', question_type: 'CBE_RESPONSE' },
                    { question_id: 'q2', question_type: 'LONG_ANSWER' },
                ],
            })
        ).toBe(2);
    });

    it('tolerates empty or broken payloads', () => {
        expect(countAiGradableQuestions(undefined)).toBe(0);
        expect(countAiGradableQuestions({})).toBe(0);
        expect(countAiGradableQuestions({ 's-1': null })).toBe(0);
        expect(
            countAiGradableQuestions({ 's-1': [{ question_type: '', marking_json: '{not json' }] })
        ).toBe(0);
    });
});
