import { describe, expect, it } from 'vitest';
import { asciiDigits, checkLength } from './length';

/** Cloth at scale 10 (10 cm), sold in steps of 10 cm, no ceiling. */
const ANY = { step: 1, max: null };

describe('checkLength', () => {
    it('reads a point, one comma, Hindi digits and trailing zeros', () => {
        expect(checkLength('2.5', 10, ANY)).toEqual({ kind: 'ok', base: 25 });
        expect(checkLength('2,5', 10, ANY)).toEqual({ kind: 'ok', base: 25 });
        expect(checkLength('२.५', 10, ANY)).toEqual({ kind: 'ok', base: 25 });
        expect(checkLength('२,५', 10, ANY)).toEqual({ kind: 'ok', base: 25 });
        expect(checkLength('2.50', 10, ANY)).toEqual({ kind: 'ok', base: 25 });
        expect(checkLength('2.500', 10, ANY)).toEqual({ kind: 'ok', base: 25 });
        expect(checkLength(' 3 ', 10, ANY)).toEqual({ kind: 'ok', base: 30 });
        expect(checkLength('3.', 10, ANY)).toEqual({ kind: 'ok', base: 30 });
        expect(checkLength('.5', 10, ANY)).toEqual({ kind: 'ok', base: 5 });
        expect(checkLength('1.25', 100, ANY)).toEqual({ kind: 'ok', base: 125 });
        expect(asciiDigits('१२३४५६७८९०')).toBe('1234567890');
    });

    it('keeps blank apart from a refusal; 0 and text are refused', () => {
        expect(checkLength('', 10, ANY)).toEqual({ kind: 'blank' });
        expect(checkLength('   ', 10, ANY)).toEqual({ kind: 'blank' });
        for (const text of ['0', '0.0', '.', 'abc', '2.5m', '-1', '1,2,3', '1,234.5', '1.2.3', '12345678', '1.00001'])
            expect(checkLength(text, 10, ANY), text).toEqual({ kind: 'format' });
    });

    it('refuses real extra precision with the two nearest lengths, never rounding', () => {
        expect(checkLength('2.55', 10, ANY)).toEqual({ kind: 'step', choices: [25, 26] });
        expect(checkLength('0.05', 10, ANY)).toEqual({ kind: 'step', choices: [1] });
        // A comma with three digits is still a decimal point, not thousands.
        expect(checkLength('1,234', 10, ANY)).toEqual({ kind: 'step', choices: [12, 13] });
    });

    it('refuses a length off the step with the lengths either side', () => {
        const linen = { step: 5, max: null };
        expect(checkLength('2.3', 10, linen)).toEqual({ kind: 'step', choices: [20, 25] });
        expect(checkLength('2.5', 10, linen)).toEqual({ kind: 'ok', base: 25 });
        // Below one step: only the step itself.
        expect(checkLength('0.2', 10, linen)).toEqual({ kind: 'step', choices: [5] });
    });

    it('reads an old odd scale with its real scale', () => {
        // Scale 4 (quarters): 1.5 is 6 base units, 1.25 is 5, 1.1 cannot be cut.
        expect(checkLength('1.5', 4, ANY)).toEqual({ kind: 'ok', base: 6 });
        expect(checkLength('1.25', 4, ANY)).toEqual({ kind: 'ok', base: 5 });
        expect(checkLength('1.1', 4, ANY)).toEqual({ kind: 'step', choices: [4, 5] });
    });

    it('refuses more than can be bought and offers the most that can', () => {
        const capped = { step: 1, max: 250 };
        expect(checkLength('25', 10, capped)).toEqual({ kind: 'ok', base: 250 });
        expect(checkLength('30', 10, capped)).toEqual({ kind: 'max', max: 250 });
        expect(checkLength('25.05', 10, capped)).toEqual({ kind: 'max', max: 250 });
        // Just under the ceiling, off the step: only the length below fits.
        expect(checkLength('24.95', 10, { step: 1, max: 250 })).toEqual({ kind: 'step', choices: [249, 250] });
        expect(checkLength('23.5', 10, { step: 30, max: 240 })).toEqual({ kind: 'step', choices: [210, 240] });
        expect(checkLength('25', 10, { step: 30, max: 240 })).toEqual({ kind: 'max', max: 240 });
    });
});
