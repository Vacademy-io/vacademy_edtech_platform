import { describe, expect, it } from 'vitest';
import { negativeMarkingPercentageFor, numericNegativeMarkingPercentage } from './negative-marking';

/** The assessment service's NUMERIC rule for a wrong answer. */
const numericWrongAnswerMarks = (negativeMark: number, percentage: number) =>
    -((negativeMark * percentage) / 100);

describe('numericNegativeMarkingPercentage', () => {
    it('is 100 whenever a penalty is set', () => {
        expect(numericNegativeMarkingPercentage('1')).toBe(100);
        expect(numericNegativeMarkingPercentage(0.5)).toBe(100);
        expect(numericNegativeMarkingPercentage('2.25')).toBe(100);
    });

    it('is 0 without a penalty', () => {
        for (const penalty of ['', '0', 0, null, undefined, 'abc', '-1', -1]) {
            expect(numericNegativeMarkingPercentage(penalty)).toBe(0);
        }
    });

    it('makes a +4 / -1 NUMERIC question cost 1 mark when wrong', () => {
        const percentage = numericNegativeMarkingPercentage('1');
        expect(numericWrongAnswerMarks(1, percentage)).toBe(-1);
    });
});

describe('negativeMarkingPercentageFor', () => {
    it('writes 100 or 0 for NUMERIC, whatever the mark', () => {
        expect(negativeMarkingPercentageFor('NUMERIC', '4', '1')).toBe(100);
        expect(negativeMarkingPercentageFor('NUMERIC', '', '1')).toBe(100);
        expect(negativeMarkingPercentageFor('NUMERIC', '4', '')).toBe(0);
        expect(negativeMarkingPercentageFor('NUMERIC', '4', '0')).toBe(0);
    });

    it('keeps the old value for other types', () => {
        expect(negativeMarkingPercentageFor('MCQS', '4', '1')).toBe(25);
        expect(negativeMarkingPercentageFor('MCQM', '4', '2')).toBe(50);
        expect(negativeMarkingPercentageFor('MCQS', '4', '0')).toBe(0);
        expect(negativeMarkingPercentageFor('MCQS', '4', '')).toBe('');
        expect(negativeMarkingPercentageFor('MCQS', '', '1')).toBe('');
        expect(negativeMarkingPercentageFor(undefined, '4', '1')).toBe(25);
    });
});
