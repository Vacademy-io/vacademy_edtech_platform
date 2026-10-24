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
