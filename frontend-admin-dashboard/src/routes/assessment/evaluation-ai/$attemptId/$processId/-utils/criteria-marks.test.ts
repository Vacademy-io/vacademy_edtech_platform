import { describe, expect, it } from 'vitest';
import { criterionMax, formatCriterionMarks } from './criteria-marks';

describe('criterionMax', () => {
    it('reads the copy-check `max`, then the slide grader `max_marks`', () => {
        expect(criterionMax({ marks: 1, max: 2 })).toBe(2);
        expect(criterionMax({ marks: 1, max_marks: 4 })).toBe(4);
        expect(criterionMax({ marks: 1, max: 0.5, max_marks: 4 })).toBe(0.5);
        expect(criterionMax({ marks: 1, max: '1.5' })).toBe(1.5);
    });

    it('is null when the line matched no rubric criterion or predates the field', () => {
        expect(criterionMax({ marks: 1, max: null })).toBeNull();
        expect(criterionMax({ marks: 1 })).toBeNull();
        expect(criterionMax({ marks: 1, max: 'n/a' })).toBeNull();
        expect(criterionMax(null)).toBeNull();
    });
});

describe('formatCriterionMarks', () => {
    it('shows "awarded / max" for a CBE marking-scheme line', () => {
        expect(formatCriterionMarks({ marks: 1.5, max: 2 })).toBe('1.5 / 2');
        expect(formatCriterionMarks({ marks: 0, max: 0.5 })).toBe('0.0 / 0.5');
        expect(formatCriterionMarks({ marks: 2, max_marks: 2 })).toBe('2.0 / 2');
    });

    it('rounds an unrounded maximum to two decimals', () => {
        expect(formatCriterionMarks({ marks: 2, max_marks: 3.3333333 })).toBe('2.0 / 3.33');
        expect(formatCriterionMarks({ marks: 1, max: 0.125 })).toBe('1.0 / 0.13');
        expect(formatCriterionMarks({ marks: 1, max: '2.50' })).toBe('1.0 / 2.5');
    });

    it('falls back to the awarded marks alone', () => {
        expect(formatCriterionMarks({ marks: 1.25 })).toBe('1.3');
        expect(formatCriterionMarks({ marks: 3, max: null })).toBe('3.0');
        expect(formatCriterionMarks({})).toBe('0.0');
    });
});
