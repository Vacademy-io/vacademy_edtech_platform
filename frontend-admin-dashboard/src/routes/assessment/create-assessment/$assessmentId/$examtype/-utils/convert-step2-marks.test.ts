import { describe, expect, it } from 'vitest';
import { convertStep2Data } from './helper';

type Step2Data = Parameters<typeof convertStep2Data>[0];
type Step2Section = Step2Data['section'][number];

/**
 * Section totals are the denominator of every percentage in the results export.
 * parseInt('12.5') is 12, so five 2.5-mark questions were saved as a 12-mark
 * section and a full score read 100 / 98 = 102.04% (UnlockX, 2026-10).
 */
const sectionWith = (totalMarks: string, cutoff: { checked: boolean; value: string }) =>
    ({
        sectionId: '',
        sectionName: 'Physics',
        section_description: '',
        section_duration: { hrs: '', min: '' },
        question_duration: { hrs: '', min: '' },
        total_marks: totalMarks,
        cutoff_marks: cutoff,
        problem_randomization: false,
        adaptive_marking_for_each_question: [],
    }) as unknown as Step2Section;

describe('convertStep2Data marks', () => {
    it('keeps a fractional section total', () => {
        const [section] = convertStep2Data({
            ...({} as Step2Data),
            section: [sectionWith('12.5', { checked: true, value: '7.5' })],
        });
        expect(section!.total_marks).toBe(12.5);
        expect(section!.cutoff_marks).toBe(7.5);
    });

    it('still sends 0 for a blank total or an unchecked cutoff', () => {
        const [section] = convertStep2Data({
            ...({} as Step2Data),
            section: [sectionWith('', { checked: false, value: '7.5' })],
        });
        expect(section!.total_marks).toBe(0);
        expect(section!.cutoff_marks).toBe(0);
    });
});

describe('convertStep2Data negative marking', () => {
    const markingFor = (questionType: string, questionMark: string, questionPenalty: string) => {
        const [section] = convertStep2Data({
            ...({} as Step2Data),
            section: [
                {
                    ...sectionWith('4', { checked: false, value: '' }),
                    adaptive_marking_for_each_question: [
                        { questionId: 'q1', questionType, questionMark, questionPenalty },
                    ],
                } as unknown as Step2Section,
            ],
        });
        return JSON.parse(section!.question_and_marking[0]!.marking_json).data;
    };

    // The grader applies a wrong NUMERIC answer as negativeMark * percentage / 100.
    it('gives a NUMERIC penalty its full value', () => {
        expect(markingFor('NUMERIC', '4', '1')).toEqual({
            totalMark: '4',
            negativeMark: '1',
            negativeMarkingPercentage: 100,
        });
        expect(markingFor('NUMERIC', '4', '').negativeMarkingPercentage).toBe(0);
    });

    it('leaves MCQS unchanged', () => {
        expect(markingFor('MCQS', '4', '1').negativeMarkingPercentage).toBe(25);
    });
});
