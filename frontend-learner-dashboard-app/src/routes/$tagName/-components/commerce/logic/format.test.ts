import { describe, expect, it } from 'vitest';
import {
    formatMoney,
    formatUnits,
    groupIndian,
    groupWestern,
    hasCompareAt,
    lineAmount,
    perUnitAmount,
    percentOff,
    quantityText,
    sumAmounts,
    unitLabel,
    unitSign,
} from './format';
import { createTranslate } from '../i18n';

describe('Indian digit grouping', () => {
    it('groups the last three digits, then pairs', () => {
        expect(groupIndian('0')).toBe('0');
        expect(groupIndian('999')).toBe('999');
        expect(groupIndian('1000')).toBe('1,000');
        expect(groupIndian('4899')).toBe('4,899');
        expect(groupIndian('12345')).toBe('12,345');
        expect(groupIndian('123456')).toBe('1,23,456');
        expect(groupIndian('1234567')).toBe('12,34,567');
        expect(groupIndian('12345678')).toBe('1,23,45,678');
        expect(groupIndian('1234567890')).toBe('1,23,45,67,890');
    });

    it('groups other currencies in threes', () => {
        expect(groupWestern('1234567')).toBe('1,234,567');
    });
});

describe('formatMoney', () => {
    it('writes rupees in the shop format', () => {
        expect(formatMoney(4899)).toBe('₹4,899');
        expect(formatMoney(123456, 'INR')).toBe('₹1,23,456');
        expect(formatMoney(0)).toBe('₹0');
        expect(formatMoney('4899.00')).toBe('₹4,899');
    });

    it('shows paise only when there are any, always two digits', () => {
        expect(formatMoney(4899.5)).toBe('₹4,899.50');
        expect(formatMoney(4899.05)).toBe('₹4,899.05');
        expect(formatMoney(0.1 + 0.2)).toBe('₹0.30');
        expect(formatMoney(4898.999)).toBe('₹4,899');
        expect(formatMoney(1234.005)).toBe('₹1,234.01');
    });

    it('never turns a missing amount into a zero', () => {
        expect(formatMoney(null)).toBeNull();
        expect(formatMoney(undefined)).toBeNull();
        expect(formatMoney('')).toBeNull();
        expect(formatMoney('abc')).toBeNull();
        expect(formatMoney(Number.NaN)).toBeNull();
    });

    it('handles a negative amount and other currencies', () => {
        expect(formatMoney(-250)).toBe('-₹250');
        expect(formatMoney(1234567, 'USD')).toBe('$1,234,567');
        expect(formatMoney(10, 'XYZ')).toBe('XYZ 10');
    });

    it('uses Latin digits and the same price text in Hindi and in English', () => {
        const hi = createTranslate('hi');
        const en = createTranslate('en');
        const price = formatMoney(123456) as string;
        expect(hi('card.from', { price })).toBe('₹1,23,456 से');
        expect(en('card.from', { price })).toBe('From ₹1,23,456');
        expect(hi('card.mrp', { price: formatMoney(5999) })).toBe('एमआरपी ₹5,999');
        expect(hi('cart.checkout', { total: formatMoney(10499.5) })).toBe('चेकआउट · ₹10,499.50');
        expect(price).toMatch(/^₹[0-9,]+$/);
    });
});

describe('compare-at price', () => {
    it('is shown only when it is really higher', () => {
        expect(hasCompareAt(4899, 5999)).toBe(true);
        expect(hasCompareAt(4899, 4899)).toBe(false);
        expect(hasCompareAt(4899, 100)).toBe(false);
        expect(hasCompareAt(4899, null)).toBe(false);
        expect(hasCompareAt(null, 5999)).toBe(false);
    });

    it('gives a whole percent, rounded down', () => {
        expect(percentOff(750, 1000)).toBe(25);
        expect(percentOff(4899, 5999)).toBe(18);
        expect(percentOff(999, 1000)).toBeNull();
        expect(percentOff(1000, 1000)).toBeNull();
        expect(percentOff(null, 1000)).toBeNull();
    });
});

describe('quantities of measured goods', () => {
    it('writes base units as units', () => {
        expect(formatUnits(25, 10)).toBe('2.5');
        expect(formatUnits(20, 10)).toBe('2');
        expect(formatUnits(5, 10)).toBe('0.5');
        expect(formatUnits(125, 100)).toBe('1.25');
        expect(formatUnits(3, 1)).toBe('3');
        expect(formatUnits(3, 0)).toBe('3');
    });

    it('prices a length from the price of one base unit', () => {
        // 45 per 10 cm: 450 a metre, 1125 for 2.5 m.
        expect(perUnitAmount(45, 10)).toBe(450);
        expect(lineAmount(45, 25)).toBe(1125);
        expect(lineAmount(33.33, 3)).toBe(99.99);
        expect(lineAmount(null, 3)).toBeNull();
    });

    it('works in whole paise, never in floats', () => {
        // ₹123.40 a metre = ₹12.34 per 10 cm; 3.4 m is 34 base units.
        expect(lineAmount(12.34, 34)).toBe(419.56);
        expect(lineAmount(12.34, 25)).toBe(308.5);
        expect(perUnitAmount(12.34, 10)).toBe(123.4);
        // A float multiply drifts here (0.30000000000000004, 3.3000000000000003); paise do not.
        expect(0.1 * 3).not.toBe(0.3);
        expect(lineAmount(0.1, 3)).toBe(0.3);
        expect(lineAmount(1.1, 3)).toBe(3.3);
        expect(lineAmount(0.07, 100)).toBe(7);
        expect(lineAmount('12.34', 34)).toBe(419.56);
        expect(sumAmounts([0.1, 0.2])).toBe(0.3);
        expect(sumAmounts([419.56, 308.5])).toBe(728.06);
        expect(sumAmounts([1, null])).toBeNull();
    });

    it('writes a quantity with its unit in the visitor\'s language', () => {
        const hi = createTranslate('hi');
        const en = createTranslate('en');
        expect(quantityText(25, 10, 'MTR', hi)).toBe('2.5 मी');
        expect(quantityText(25, 10, 'MTR', en)).toBe('2.5 m');
        expect(quantityText(30, 10, 'mtr', en)).toBe('3 m');
        expect(quantityText(1500, 1000, 'KGS', en)).toBe('1.5 kg');
        expect(quantityText(7, 100, 'YD', en)).toBe('0.07 yd');
        // Pieces read as a plain count.
        expect(quantityText(2, 1, 'PCS', hi)).toBe('2');
        expect(quantityText(2, null, null, en)).toBe('2');
    });

    it('names units, falling back to the code for a unit it has no word for', () => {
        const hi = createTranslate('hi');
        const en = createTranslate('en');
        expect(unitLabel(en, 'MTR')).toBe('metre');
        expect(unitLabel(hi, 'MTR')).toBe('मीटर');
        expect(unitLabel(hi, 'METRE', true)).toBe('मी');
        expect(unitLabel(en, 'KG', true)).toBe('kg');
        expect(unitLabel(en, 'CM', true)).toBe('cm');
        expect(unitLabel(hi, 'CMS', true)).toBe('सेमी');
        expect(unitLabel(en, 'LTR', true)).toBe('l');
        expect(unitLabel(en, 'YD')).toBe('yd');
        expect(unitLabel(hi, 'YD', true)).toBe('yd');
        // "piece" only for pieces.
        expect(unitLabel(en, 'PCS')).toBe('piece');
        expect(unitLabel(en, 'NOS')).toBe('piece');
        expect(unitLabel(en, null)).toBe('piece');
        expect(unitLabel(en, '')).toBe('piece');
        expect(unitSign('MTR')).toBe('m');
        expect(unitSign('MLT')).toBe('ml');
        expect(unitSign('PCS')).toBeNull();
    });
});
