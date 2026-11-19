/**
 * Money and quantities as a shopper reads them: Latin digits in
 * both languages, Indian digit grouping (₹1,23,456), no decimals on a whole amount. Written by
 * hand so the result does not depend on the ICU data of the visitor's browser.
 */

import type { Translate } from '../i18n';

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };

/** 1234567 -> "12,34,567": the last three digits, then groups of two. */
export const groupIndian = (digits: string): string => {
    if (digits.length <= 3) return digits;
    const head = digits.slice(0, -3);
    const tail = digits.slice(-3);
    return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
};

/** 1234567 -> "1,234,567". */
export const groupWestern = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const toFiniteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
};

/**
 * "₹4,899", "₹4,899.50", "₹1,23,456". Null for a missing amount: a caller shows a placeholder,
 * never a zero that reads as "free".
 */
export const formatMoney = (amount: unknown, currency: string | null | undefined = 'INR'): string | null => {
    const value = toFiniteNumber(amount);
    if (value === null) return null;
    const code = (currency || 'INR').toUpperCase();
    // Round to paise first, so 4898.999 does not print as 4898.100.
    const paise = Math.round(Math.abs(value) * 100);
    const whole = Math.floor(paise / 100);
    const fraction = paise % 100;
    const grouped = code === 'INR' ? groupIndian(String(whole)) : groupWestern(String(whole));
    const symbol = CURRENCY_SYMBOL[code] ?? `${code} `;
    const sign = value < 0 && paise > 0 ? '-' : '';
    return `${sign}${symbol}${grouped}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
};

/** Percent off the compare-at price, whole and rounded down; null when there is no real saving. */
export const percentOff = (amount: unknown, compareAt: unknown): number | null => {
    const price = toFiniteNumber(amount);
    const mrp = toFiniteNumber(compareAt);
    if (price === null || mrp === null || mrp <= price || price < 0) return null;
    const pct = Math.floor(((mrp - price) / mrp) * 100);
    return pct >= 1 ? pct : null;
};

/** True when the compare-at price is a real, higher price worth striking through. */
export const hasCompareAt = (amount: unknown, compareAt: unknown): boolean => {
    const price = toFiniteNumber(amount);
    const mrp = toFiniteNumber(compareAt);
    return price !== null && mrp !== null && mrp > price;
};

/**
 * A quantity in base units as a number of units: 25 base units at scale 10 is "2.5". Trailing
 * zeros are dropped; the scale decides how many decimals can appear.
 */
export const formatUnits = (baseUnits: number, qtyScale: number): string => {
    const scale = Math.max(1, Math.floor(qtyScale || 1));
    if (scale === 1) return String(Math.round(baseUnits));
    const decimals = Math.max(1, Math.ceil(Math.log10(scale)));
    return (baseUnits / scale)
        .toFixed(decimals)
        .replace(/\.?0+$/, '');
};

/**
 * Whole paise of a price. The API prices one base unit in rupees and paise; a price is never
 * multiplied as a float (12.34 × 34 must be 419.56, not 419.55999…).
 */
const toPaise = (value: number): number => Math.round(value * 100);

/** The price of a quantity in base units, given the price of ONE base unit: exact in paise. */
export const lineAmount = (unitPrice: unknown, baseUnits: number): number | null => {
    const price = toFiniteNumber(unitPrice);
    if (price === null || !Number.isFinite(baseUnits)) return null;
    return Math.round(toPaise(price) * baseUnits) / 100;
};

/** The price of one whole unit (a metre) from the price of one base unit (10 cm). */
export const perUnitAmount = (unitPrice: unknown, qtyScale: number): number | null =>
    lineAmount(unitPrice, Math.max(1, Math.floor(qtyScale || 1)));

/** Adds amounts in whole paise; null when any amount is unknown. */
export const sumAmounts = (amounts: readonly (number | null)[]): number | null => {
    let paise = 0;
    for (const amount of amounts) {
        if (amount === null || !Number.isFinite(amount)) return null;
        paise += toPaise(amount);
    }
    return paise / 100;
};

/* ── units ────────────────────────────────────────────────────────── */

const unitCode = (unit: string | null | undefined): string => (unit || '').trim().toUpperCase();

/** Codes that count pieces: no sign after the number. */
const PIECE_CODES = new Set(['', 'PCS', 'PC', 'NOS', 'NO', 'PIECE', 'PIECES']);

/** The sign printed after a quantity, in every language (analytics, plain text). */
const UNIT_SIGNS: Record<string, string> = {
    MTR: 'm',
    M: 'm',
    METER: 'm',
    METRE: 'm',
    CM: 'cm',
    CMS: 'cm',
    KG: 'kg',
    KGS: 'kg',
    G: 'g',
    GM: 'g',
    GMS: 'g',
    LTR: 'l',
    L: 'l',
    ML: 'ml',
    MLT: 'ml',
};

/**
 * The sign of a unit code: MTR → "m", KGS → "kg"; any other code in lower case ("YD" → "yd");
 * null for pieces (PCS, NOS, blank).
 */
export const unitSign = (unit: string | null | undefined): string | null => {
    const code = unitCode(unit);
    if (PIECE_CODES.has(code)) return null;
    return UNIT_SIGNS[code] ?? code.toLowerCase();
};

/**
 * Unit names from the API codes in the visitor's language: "मीटर" / "मी" for MTR. A code the
 * shop has no word for is shown as itself in lower case; "piece" only for pieces.
 */
export const unitLabel = (t: Translate, unit: string | null | undefined, short = false): string => {
    const sign = unitSign(unit);
    switch (sign) {
        case null:
            return t(short ? 'unit.PCS.short' : 'unit.PCS');
        case 'm':
            return t(short ? 'unit.MTR.short' : 'unit.MTR');
        case 'kg':
            return t(short ? 'unit.KG.short' : 'unit.KG');
        case 'cm':
            return t('unit.CM.short');
        case 'g':
            return t('unit.G.short');
        case 'l':
            return t('unit.L.short');
        case 'ml':
            return t('unit.ML.short');
        default:
            return sign;
    }
};

/**
 * A quantity in base units as a shopper reads it: "2.5 मी" / "2.5 m" for goods sold by length or
 * weight, the plain count ("2") for everything else.
 */
export const quantityText = (baseUnits: number, qtyScale: number | null | undefined, unit: string | null | undefined, t: Translate): string => {
    const scale = Math.max(1, Math.floor(qtyScale || 1));
    if (scale === 1) return String(Math.round(baseUnits));
    return `${formatUnits(baseUnits, scale)} ${unitLabel(t, unit, true)}`;
};
