/** WP-44 FA1: one formatter for lengths, rates and typed lengths on every commerce screen. */
import { describe, expect, it } from 'vitest';
import { localeT } from './en-t';
import {
    costInputText,
    decimalsFor,
    formatCost,
    formatRate,
    isPieceUnit,
    lengthInputText,
    lengthProblemText,
    lengthNumber,
    lineValuePaise,
    parseCostPerUnit,
    parseLength,
    perUnit,
    perUnitToBasePrice,
    ratePaise,
    unitSign,
    unitWord,
} from './units';

const en = localeT('en');
const hi = localeT('hi');

describe('unit signs', () => {
    it('MTR → m, KGS → kg, PCS → null, YD → yd', () => {
        expect(unitSign('MTR')).toBe('m');
        expect(unitSign('metre')).toBe('m');
        expect(unitSign('KGS')).toBe('kg');
        expect(unitSign('PCS')).toBeNull();
        expect(unitSign('NOS')).toBeNull();
        expect(unitSign('')).toBeNull();
        expect(unitSign('YD')).toBe('yd');
        expect(perUnit('MTR')).toBe(' / m');
        expect(perUnit('PCS')).toBe('');
    });

    it('one piece-code list (W2): PC, NO, PIECE, PIECES and blank print no sign either', () => {
        ['PCS', 'NOS', 'PC', 'NO', 'PIECE', 'pieces', '', null].forEach((code) => {
            expect(isPieceUnit(code)).toBe(true);
            expect(unitSign(code)).toBeNull();
        });
        expect(isPieceUnit('MTR')).toBe(false);
    });

    it('metres read the admin word; other codes their sign', () => {
        expect(unitWord('MTR', en)).toBe('m');
        expect(unitWord('MTR', hi)).toBe('मीटर');
        // A blank unit is not guessed to be metres (W13).
        expect(unitWord(null, hi)).toBeNull();
        expect(unitWord('', en)).toBeNull();
        expect(unitWord('KG', hi)).toBe('kg');
        expect(unitWord('PCS', en)).toBeNull();
    });
});

describe('lengths', () => {
    it('base ÷ scale with at most log10(scale) decimals, trailing zeros dropped', () => {
        expect(lengthNumber(25, 10)).toBe('2.5');
        expect(lengthNumber(30, 10)).toBe('3');
        expect(lengthNumber(34, 10)).toBe('3.4');
        expect(lengthNumber(7, 100)).toBe('0.07');
        expect(lengthNumber(2, 1)).toBe('2');
        expect(lengthInputText(237, 10)).toBe('23.7');
        expect(lengthInputText(30, 10)).toBe('3');
        expect(lengthInputText(0, 10)).toBe('0');
        expect(decimalsFor(1)).toBe(0);
        expect(decimalsFor(10)).toBe(1);
        expect(decimalsFor(1000)).toBe(3);
    });

    it('a typed length refuses extra decimals instead of rounding', () => {
        expect(parseLength('2.55', 10)).toEqual({ problem: 'decimals' });
        expect(parseLength('3', 10)).toEqual({ stored: 30 });
        expect(parseLength(' 0.07 ', 100)).toEqual({ stored: 7 });
        expect(parseLength('1.2', 10)).toEqual({ stored: 12 });
        expect(parseLength('1.5', 1)).toEqual({ problem: 'decimals' });
        expect(parseLength('abc', 10)).toEqual({ problem: 'format' });
        expect(parseLength('', 10)).toEqual({ problem: 'format' });
        expect(parseLength('.', 10)).toEqual({ problem: 'format' });
        expect(parseLength('-1', 10)).toEqual({ problem: 'format' });
    });

    it('W4: trailing zeros are fine, Hindi digits are digits, a comma is refused', () => {
        expect(parseLength('2.50', 10)).toEqual({ stored: 25 });
        expect(parseLength('2.500', 10)).toEqual({ stored: 25 });
        expect(parseLength('2.0', 1)).toEqual({ stored: 2 });
        expect(parseLength('5.', 10)).toEqual({ stored: 50 });
        expect(parseLength('.5', 10)).toEqual({ stored: 5 });
        expect(parseLength('२.५', 10)).toEqual({ stored: 25 });
        expect(parseLength('१२', 1)).toEqual({ stored: 12 });
        // Never read as a decimal point nor as thousands.
        expect(parseLength('2,5', 10)).toEqual({ problem: 'comma' });
        expect(parseLength('1,000', 1)).toEqual({ problem: 'comma' });
    });

    it('W12: more than 10,000,000 base units is "too large", not "enter a number"', () => {
        expect(parseLength('1000000', 10)).toEqual({ stored: 10_000_000 });
        expect(parseLength('1000000.1', 10)).toEqual({ problem: 'tooLarge' });
        expect(parseLength('12345678', 10)).toEqual({ problem: 'tooLarge' });
        expect(parseLength('9999999', 1000)).toEqual({ problem: 'tooLarge' });
        expect(parseLength('99999999999999999999', 1)).toEqual({ problem: 'tooLarge' });
    });

    it('W3: an old row with an odd scale is read with its real scale, never a rounded one', () => {
        expect(decimalsFor(4)).toBe(2);
        expect(decimalsFor(5)).toBe(1);
        expect(decimalsFor(25)).toBe(2);
        expect(parseLength('1.5', 4)).toEqual({ stored: 6 });
        expect(parseLength('0.25', 4)).toEqual({ stored: 1 });
        expect(parseLength('1.3', 4)).toEqual({ problem: 'grid' });
        expect(parseLength('0.2', 5)).toEqual({ stored: 1 });
        expect(parseLength('0.5', 5)).toEqual({ problem: 'grid' });
        expect(parseLength('0.04', 25)).toEqual({ stored: 1 });
        expect(parseLength('0.25', 25)).toEqual({ problem: 'grid' });
        expect(lengthInputText(6, 4)).toBe('1.5');
    });

    it('says why, in plain words (plural decimals, comma, too large, grid)', () => {
        expect(lengthProblemText('decimals', 10, en)).toBe('Use at most 1 decimal place, like 2.5. Nothing is rounded.');
        expect(lengthProblemText('decimals', 100, en)).toBe('Use at most 2 decimal places, like 2.5. Nothing is rounded.');
        expect(lengthProblemText('comma', 10, en)).toBe('Use a dot for decimals, like 2.5.');
        expect(lengthProblemText('tooLarge', 10, en)).toBe('That is too large. Enter at most 1,000,000.');
        expect(lengthProblemText('grid', 4, en)).toBe('Enter a multiple of 0.25.');
        expect(lengthProblemText('comma', 10, hi)).toMatch(/[ऀ-ॿ]/);
    });
});

describe('rates per metre', () => {
    it('₹12.34 per 10 cm reads "₹123.40 / m", in paise', () => {
        expect(formatRate(12.34, 10, 'MTR')).toBe('₹123.40 / m');
        expect(formatRate(12.34, 10, 'MTR', 'INR', en)).toBe('₹123.40 / m');
        expect(formatRate(12.34, 10, 'MTR', 'INR', hi)).toBe('₹123.40 / मीटर');
        expect(formatRate(450, 1, 'PCS')).toBe('₹450.00');
        expect(formatRate('20', 10, 'MTR')).toBe('₹200.00 / m');
    });

    it('a blank or piece unit prints no "/ m" (W13)', () => {
        expect(formatRate(12.34, 10, '')).toBe('₹123.40');
        expect(formatRate(12.34, 10, null)).toBe('₹123.40');
        expect(formatRate(12.34, 10, 'PCS', 'INR', en)).toBe('₹123.40');
    });

    it('no float drift: 0.1 + 0.2 style prices stay exact', () => {
        // 0.29 × 10 in floats is 2.9000000000000004; in paise it is 290.
        expect(ratePaise(0.29, 10)).toBe(290);
        expect(formatRate(0.1 + 0.2, 10, 'MTR')).toBe('₹3.00 / m');
        expect(lineValuePaise(12.34, 34)).toBe(41956);
        expect(lineValuePaise(12.34, 25)).toBe(30850);
    });

    it('a per-metre price splits into 10 equal paise or is refused', () => {
        expect(perUnitToBasePrice(123.4, 10)).toBe(12.34);
        expect(perUnitToBasePrice(123.45, 10)).toBeNull();
        expect(perUnitToBasePrice(450, 1)).toBe(450);
    });
});

describe('unit cost per metre (D13)', () => {
    it('"80.00" a metre is sent as 8.0000 per 10 cm', () => {
        expect(parseCostPerUnit('80.00', 10)).toEqual({ baseCost: '8.0000' });
        expect(parseCostPerUnit('80.005', 10)).toEqual({ baseCost: '8.0005' });
        expect(parseCostPerUnit('120.5', 1)).toEqual({ baseCost: '120.5000' });
    });

    it('a cost that does not fit 4 decimals per base unit is refused (3 per metre at scale 10)', () => {
        expect(parseCostPerUnit('80.0005', 10)).toEqual({ problem: 'decimals' });
        expect(parseCostPerUnit('8.00005', 1)).toEqual({ problem: 'decimals' });
        expect(parseCostPerUnit('abc', 10)).toEqual({ problem: 'format' });
    });

    it('a money box refuses a comma too (W4) and reads Hindi digits', () => {
        expect(parseCostPerUnit('80,5', 10)).toEqual({ problem: 'comma' });
        expect(parseCostPerUnit('1,200', 1)).toEqual({ problem: 'comma' });
        expect(parseCostPerUnit('८०', 10)).toEqual({ baseCost: '8.0000' });
    });

    it('shows and pre-fills per metre', () => {
        expect(costInputText(8, 10)).toBe('80');
        expect(costInputText(8.0005, 10)).toBe('80.005');
        expect(costInputText(null, 10)).toBe('');
        expect(formatCost(8, 10, 'MTR', en)).toBe('₹80.00 / m');
        expect(formatCost(8.0005, 10, 'MTR', en)).toBe('₹80.005 / m');
        expect(formatCost(45, 1, 'PCS', en)).toBe('₹45.00');
    });
});
