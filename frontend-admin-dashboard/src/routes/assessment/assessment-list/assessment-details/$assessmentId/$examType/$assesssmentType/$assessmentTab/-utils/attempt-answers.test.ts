import { describe, expect, it } from 'vitest';
import {
    clampMarks,
    fullMarksOf,
    isChoiceQuestion,
    marksSourceKind,
    parseCriteria,
    parseKeyText,
    parseSavedAnswer,
    sortByPaperOrder,
} from './attempt-answers';

describe('parseSavedAnswer', () => {
    it('reads option ids from the stored question node', () => {
        const raw = JSON.stringify({
            questionId: 'q1',
            responseData: { type: 'MCQS', optionIds: ['o2'] },
        });
        expect(parseSavedAnswer(raw).optionIds).toEqual(['o2']);
    });

    it('reads typed text and numeric answers', () => {
        expect(
            parseSavedAnswer({ responseData: { type: 'LONG_ANSWER', answer: '<p>Essay</p>' } }).text
        ).toBe('<p>Essay</p>');
        expect(
            parseSavedAnswer('{"responseData":{"type":"NUMERIC","validAnswer":2.05}}').numeric
        ).toBe(2.05);
        expect(parseSavedAnswer('{"type":"NUMERIC","validAnswer":"7"}').numeric).toBe(7);
    });

    it('is empty for a skipped or unreadable answer', () => {
        expect(parseSavedAnswer(null)).toEqual({ optionIds: [], text: null, numeric: null });
        expect(parseSavedAnswer('not json')).toEqual({ optionIds: [], text: null, numeric: null });
        expect(parseSavedAnswer('{"responseData":{"answer":"  "}}').text).toBeNull();
    });
});

describe('parseKeyText', () => {
    it('reads numeric, one-word and long-answer keys', () => {
        expect(parseKeyText('{"type":"NUMERIC","data":{"validAnswers":[2.5,3]}}')).toBe('2.5 / 3');
        expect(parseKeyText('{"type":"ONE_WORD","data":{"answer":"Delhi"}}')).toBe('Delhi');
        expect(
            parseKeyText('{"type":"LONG_ANSWER","data":{"answer":{"content":"<p>Model</p>"}}}')
        ).toBe('<p>Model</p>');
        expect(parseKeyText('{"type":"MCQS","data":{"correctOptionIds":["o1"]}}')).toBeNull();
        expect(parseKeyText(null)).toBeNull();
    });
});

describe('marks helpers', () => {
    it('reads full marks as number or text', () => {
        expect(fullMarksOf('{"data":{"totalMark":"4"}}')).toBe(4);
        expect(fullMarksOf('{"data":{"totalMark":5}}')).toBe(5);
        expect(fullMarksOf('{"data":{}}')).toBeNull();
        expect(fullMarksOf(null)).toBeNull();
    });

    it('keeps entered marks between 0 and full marks', () => {
        expect(clampMarks(9, 4)).toBe(4);
        expect(clampMarks(-2, 4)).toBe(0);
        expect(clampMarks(2.5, 4)).toBe(2.5);
        expect(clampMarks(9, null)).toBe(9);
    });

    it('names where a mark came from', () => {
        expect(marksSourceKind(null)).toBe('auto');
        expect(marksSourceKind('AI')).toBe('ai');
        expect(marksSourceKind('AI_REVIEWED')).toBe('aiReviewed');
        expect(marksSourceKind('TEACHER')).toBe('teacher');
    });

    it('knows the choice question types', () => {
        expect(isChoiceQuestion('MCQS')).toBe(true);
        expect(isChoiceQuestion('CMCQM')).toBe(true);
        expect(isChoiceQuestion('TRUE_FALSE')).toBe(true);
        expect(isChoiceQuestion('LONG_ANSWER')).toBe(false);
    });

    it('sorts rows in paper order, unknown order last', () => {
        const rows = [{ question_order: 3 }, { question_order: null }, { question_order: 1 }];
        expect(sortByPaperOrder(rows).map((r) => r.question_order)).toEqual([1, 3, null]);
    });
});

describe('parseCriteria', () => {
    it('reads the AI line-by-line marks of a CBT answer', () => {
        const raw = JSON.stringify([
            { criteria_name: 'Revenue formula', marks: 2, max_marks: 2, reason: 'Correct SUM' },
            { criteria_name: 'Memo', marks: '1.5', reason: 'Partly argued' },
        ]);
        expect(parseCriteria(raw)).toEqual([
            { criteria_name: 'Revenue formula', marks: 2, max_marks: 2, reason: 'Correct SUM' },
            { criteria_name: 'Memo', marks: 1.5, max_marks: undefined, reason: 'Partly argued' },
        ]);
    });

    it('is empty for nothing or junk', () => {
        expect(parseCriteria(null)).toEqual([]);
        expect(parseCriteria('nope')).toEqual([]);
        expect(parseCriteria('{"a":1}')).toEqual([]);
    });
});
