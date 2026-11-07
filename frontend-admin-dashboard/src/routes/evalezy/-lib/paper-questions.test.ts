import { describe, expect, it } from 'vitest';
import type { CopyCheckCriteriaQuestion } from '@/services/copy-check-criteria';
import type { QuestionData } from '@/types/assessments/assessment-steps';
import { buildPaperSections, markingWithMarks, sectionTotalWithMarks } from './paper-questions';

const question = (id: string, order: number, marking: string | null = null): QuestionData =>
    ({
        question_id: id,
        question: { id, type: 'HTML', content: `<p>${id}</p>` },
        section_id: 's',
        question_duration: 0,
        question_order: order,
        marking_json: marking,
        evaluation_criteria_json: null,
        criteria_template_id: null,
        question_type: 'LONG_ANSWER',
    }) as QuestionData;

const marking = (totalMark: string, negativeMark = '0') =>
    JSON.stringify({ type: 'MCQS', data: { totalMark, negativeMark } });

describe('buildPaperSections', () => {
    it('orders sections and questions and numbers across sections', () => {
        const out = buildPaperSections(
            [
                { id: 'b', name: 'B', section_order: 2 },
                { id: 'a', name: 'A', section_order: 1 },
            ],
            { a: [question('a2', 2), question('a1', 1)], b: [question('b1', 1)] }
        );
        expect(out.map((s) => s.name)).toEqual(['A', 'B']);
        expect(out.flatMap((s) => s.questions.map((q) => [q.id, q.number]))).toEqual([
            ['a1', 1],
            ['a2', 2],
            ['b1', 3],
        ]);
    });

    it('reads marks and negative marks from the marking json', () => {
        const [section] = buildPaperSections([{ id: 'a' }], {
            a: [question('q', 1, marking('5', '1.5'))],
        });
        expect(section?.questions[0]).toMatchObject({ marks: 5, negativeMarks: 1.5 });
    });

    it('treats broken marking json as 0 marks instead of crashing', () => {
        const [section] = buildPaperSections([{ id: 'a' }], {
            a: [question('q', 1, '{not json')],
        });
        expect(section?.questions[0]).toMatchObject({ marks: 0, negativeMarks: 0 });
    });

    it('takes the number and marks the copy check uses when it has them', () => {
        const known = {
            question_id: 'q',
            number: 7,
            text: '',
            question_type: 'LONG_ANSWER',
            max_marks: 4,
            rubric: null,
            question_criteria: null,
        } satisfies CopyCheckCriteriaQuestion;
        const [section] = buildPaperSections(
            [{ id: 'a' }],
            { a: [question('q', 1, marking('5'))] },
            [known]
        );
        expect(section?.questions[0]).toMatchObject({ number: 7, marks: 4, criteria: known });
    });

    it('keeps the question marks when the copy check reports 0', () => {
        const known = {
            question_id: 'q',
            number: 1,
            text: '',
            question_type: 'LONG_ANSWER',
            max_marks: 0,
            rubric: null,
            question_criteria: null,
        } satisfies CopyCheckCriteriaQuestion;
        const [section] = buildPaperSections(
            [{ id: 'a' }],
            { a: [question('q', 1, marking('5'))] },
            [known]
        );
        expect(section?.questions[0]?.marks).toBe(5);
    });

    it('drops empty sections and copes with no data yet', () => {
        expect(buildPaperSections([{ id: 'a' }], { a: [] })).toEqual([]);
        expect(buildPaperSections([{ id: 'a' }], undefined)).toEqual([]);
    });
});

describe('markingWithMarks', () => {
    it('changes the marks and keeps the rest of the scheme', () => {
        const out = JSON.parse(markingWithMarks(marking('5', '1'), 'LONG_ANSWER', 7.5));
        expect(out).toEqual({ type: 'MCQS', data: { totalMark: '7.5', negativeMark: '1' } });
    });

    it('builds a scheme when there is none or it is broken', () => {
        for (const stored of [null, '{not json']) {
            expect(JSON.parse(markingWithMarks(stored, 'LONG_ANSWER', 4))).toEqual({
                type: 'LONG_ANSWER',
                data: { totalMark: '4', negativeMark: '0' },
            });
        }
    });
});

describe('sectionTotalWithMarks', () => {
    const sectionOf = (totalMarks: number | null) => {
        const [section] = buildPaperSections([{ id: 'a', total_marks: totalMarks }], {
            a: [question('x', 1, marking('5')), question('y', 2, marking('3'))],
        });
        return section!;
    };

    it('follows the question when the total was the sum', () => {
        expect(sectionTotalWithMarks(sectionOf(8), 'x', 2)).toBe(5);
    });

    it('leaves a deliberate total alone', () => {
        expect(sectionTotalWithMarks(sectionOf(5), 'x', 2)).toBe(5);
    });

    it('has nothing to send when the section has no total', () => {
        expect(sectionTotalWithMarks(sectionOf(null), 'x', 2)).toBeNull();
    });
});
