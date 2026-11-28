import type { TFunction } from 'i18next';
import { formatMoney } from '@/components/design-system/money-cell';
import { formatNumber } from '@/lib/formatters';

/**
 * Lengths and other measured quantities on every commerce screen (WP-44).
 *
 * The wire holds a whole number of base units: at `qty_scale` 10 one base unit
 * is a tenth of the unit (10 cm of a metre). People read and type the unit
 * ("2.5 m") and a rate per unit ("₹123.40 / m"); the price on the wire is per
 * base unit. A typed length with more decimals than the scale allows is
 * refused, never rounded.
 */

/** Short unit signs ("2.5 m", "₹120 / kg"); other codes print in small letters. */
export const UNIT_SIGNS: Record<string, string> = {
    MTR: 'm',
    M: 'm',
    METER: 'm',
    METRE: 'm',
    CMS: 'cm',
    CM: 'cm',
    KGS: 'kg',
    KG: 'kg',
    GMS: 'g',
    G: 'g',
    LTR: 'l',
    L: 'l',
    MLT: 'ml',
    ML: 'ml',
};

const METRE_CODES = new Set(['MTR', 'M', 'METER', 'METRE']);

/**
 * Codes that count pieces, not a measure: they print no sign. One list with the
 * server and the shop (WP-44 W2): a measured item may not use one of them.
 */
export const PIECE_UNIT_CODES: readonly string[] = ['PCS', 'NOS', 'PC', 'NO', 'PIECE', 'PIECES'];
const PIECE_CODES = new Set(PIECE_UNIT_CODES);

/** True when a unit is blank or counts pieces (no measure to print or type). */
export const isPieceUnit = (unit: string | null | undefined): boolean => {
    const u = (unit ?? '').trim().toUpperCase();
    return !u || PIECE_CODES.has(u);
};

/** The sign of a measuring unit (null for pieces and a blank unit). */
export function unitSign(unit: string | null | undefined): string | null {
    if (isPieceUnit(unit)) return null;
    const u = (unit ?? '').trim().toUpperCase();
    return UNIT_SIGNS[u] ?? u.toLowerCase();
}

/** A unit after the price for measured goods (" / m", " / kg"); nothing for pieces. */
export const perUnit = (unit: string | null | undefined): string => {
    const sign = unitSign(unit);
    return sign ? ` / ${sign}` : '';
};

/**
 * The unit word of a measured quantity in the admin's language: metres read the
 * metre word (`orders.units.metre`: "m" / "मीटर"), any other code its sign
 * ("kg"); pieces and a blank unit nothing (never a guessed "m").
 */
export function unitWord(unit: string | null | undefined, t: TFunction): string | null {
    const u = (unit ?? '').trim().toUpperCase();
    if (METRE_CODES.has(u)) return t('orders.units.metre');
    return unitSign(unit);
}

/** A scale above 1 means the item is sold by length (or weight). */
export const isMeasuredScale = (qtyScale: number | null | undefined): boolean => !!qtyScale && qtyScale > 1;

const scaleOf = (qtyScale: number | null | undefined): number => (qtyScale && qtyScale > 1 ? qtyScale : 1);

/** Decimals that show one base unit exactly (4 → 2 for 0.25), or null when none do (3). */
function exactDecimals(scale: number): number | null {
    let n = scale;
    let twos = 0;
    let fives = 0;
    while (n % 2 === 0) {
        n /= 2;
        twos += 1;
    }
    while (n % 5 === 0) {
        n /= 5;
        fives += 1;
    }
    return n === 1 ? Math.max(twos, fives) : null;
}

/**
 * Decimals a person may type for a scale: 1 → 0, 10 → 1, 100 → 2, 1000 → 3.
 * An old row with another scale (4) gets what shows its base unit (0.25 → 2).
 */
export const decimalsFor = (qtyScale: number | null | undefined): number => {
    const scale = scaleOf(qtyScale);
    if (scale === 1) return 0;
    return Math.max(1, exactDecimals(scale) ?? Math.ceil(Math.log10(scale)));
};

/**
 * The stored integer as the number people read, without a unit: 25 at scale 10
 * → "2.5", 30 → "3", at most `decimalsFor(scale)` decimals, trailing zeros dropped.
 */
export function lengthNumber(base: number, qtyScale: number | null | undefined): string {
    const scale = scaleOf(qtyScale);
    if (scale === 1) return formatNumber(base);
    return formatNumber(base / scale, { minimumFractionDigits: 0, maximumFractionDigits: decimalsFor(scale) });
}

/** The stored integer as plain text for an input box ("2.5"; no grouping, point decimal). */
export function lengthInputText(base: number, qtyScale: number | null | undefined): string {
    const scale = scaleOf(qtyScale);
    if (scale === 1) return String(base);
    const digits = decimalsFor(scale);
    return (base / scale).toFixed(digits).replace(/\.?0+$/, '') || '0';
}

export type LengthProblem = 'format' | 'decimals' | 'grid' | 'comma' | 'tooLarge';

/** The most base units any typed quantity may name (the server's bound; WP-44 W12). */
export const MAX_TYPED_BASE_UNITS = 10_000_000;

const DEVANAGARI_ZERO = 0x0966;

/** Hindi keyboard digits (०-९) read as 0-9, so a Devanagari keypad types numbers. */
export const asciiDigits = (text: string): string =>
    text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - DEVANAGARI_ZERO));

/**
 * A typed decimal number, one rule for every admin length and money box
 * (WP-44 W4): Hindi digits are read as digits; a comma is refused ("use a dot",
 * never read as thousands or as the decimal point); trailing zeros are fine
 * ("2.50" is 2.5). The whole part and the fraction (trailing zeros dropped)
 * come back as digit strings.
 */
export function readDecimal(text: string): { whole: string; fraction: string } | { problem: 'format' | 'comma' } {
    const trimmed = asciiDigits(text).trim();
    if (trimmed.includes(',')) return { problem: 'comma' };
    const match = /^(\d*)(?:\.(\d*))?$/.exec(trimmed);
    if (!match || !/\d/.test(trimmed)) return { problem: 'format' };
    return { whole: (match[1] ?? '').replace(/^0+(?=\d)/, '') || '0', fraction: (match[2] ?? '').replace(/0+$/, '') };
}

/**
 * Typed text in the display unit → base units (WP-44 FA1, W3, W4). Refused,
 * never rounded: more decimals than the scale shows (`decimals`), a length
 * that is not a whole number of base units on an old odd scale (`grid`), a
 * comma, or more than the server takes (`tooLarge`). Worked in whole numbers
 * with the real scale, so a stored scale 4 reads "1.5" as 6. Zero and the
 * caller's own range are the caller's.
 */
export function parseLength(
    text: string,
    qtyScale: number | null | undefined
): { stored: number } | { problem: LengthProblem } {
    const read = readDecimal(text);
    if ('problem' in read) return read;
    const { whole, fraction } = read;
    if (fraction.length > decimalsFor(qtyScale)) return { problem: 'decimals' };
    const scale = BigInt(scaleOf(qtyScale));
    const denominator = 10n ** BigInt(fraction.length);
    const scaled = BigInt(whole + fraction) * scale;
    if (scaled % denominator !== 0n) return { problem: 'grid' };
    const stored = scaled / denominator;
    if (stored > BigInt(MAX_TYPED_BASE_UNITS)) return { problem: 'tooLarge' };
    return { stored: Number(stored) };
}

/** The sentence for a refused typed length (keys under `units.problems`). */
export function lengthProblemText(problem: LengthProblem, qtyScale: number | null | undefined, t: TFunction): string {
    switch (problem) {
        case 'format':
            return t('units.problems.format');
        case 'comma':
            return t('units.problems.comma');
        case 'tooLarge':
            return t('units.problems.tooLarge', { max: lengthNumber(MAX_TYPED_BASE_UNITS, qtyScale) });
        case 'grid':
            return t('units.problems.grid', { amount: lengthInputText(1, qtyScale) });
        default: {
            const digits = decimalsFor(qtyScale);
            return digits === 0 ? t('units.problems.whole') : t('units.problems.decimals', { count: digits });
        }
    }
}

/** Why a typed quantity box must stop Save (WP-44 W5). */
export type BoxProblem = LengthProblem | 'blank' | 'low' | 'high';

/**
 * A typed quantity box on a screen that saves stock or money: blank, refused or
 * outside `min`..`max` base units stops Save (never "the last good keystroke").
 * An untouched box (`undefined`) shows a stored value and is fine.
 */
export function typedBoxProblem(
    text: string | undefined,
    qtyScale: number | null | undefined,
    range: { min: number; max?: number }
): BoxProblem | null {
    if (text === undefined) return null;
    if (text.trim() === '') return 'blank';
    const parsed = parseLength(text, qtyScale);
    if ('problem' in parsed) return parsed.problem;
    if (parsed.stored < range.min) return 'low';
    if (range.max !== undefined && parsed.stored > range.max) return 'high';
    return null;
}

/** The sentence for a box problem; `highText` is the screen's own "too much" sentence. */
export function boxProblemText(
    problem: BoxProblem,
    qtyScale: number | null | undefined,
    t: TFunction,
    highText: string
): string {
    if (problem === 'blank') return t('units.problems.blank');
    if (problem === 'low') return t('units.problems.aboveZero');
    if (problem === 'high') return highText;
    return lengthProblemText(problem, qtyScale, t);
}

/** A price in whole paise (12.34 → 1234). */
export const toPaise = (amount: number): number => Math.round(amount * 100);

/** The price of one display unit: per-base-unit price × scale, in integer paise. */
export const ratePaise = (unitPrice: number, qtyScale: number | null | undefined): number =>
    toPaise(unitPrice) * scaleOf(qtyScale);

/** The value of `base` units at a per-base-unit price, exact in paise. */
export const lineValuePaise = (unitPrice: number, base: number): number => toPaise(unitPrice) * base;

/**
 * The rate people read: "₹123.40 / m" for measured goods (per-base-unit price ×
 * scale, in paise so 12.34 × 10 never drifts), "₹45.00" for pieces. With `t`
 * metres read the admin's metre word.
 */
export function formatRate(
    unitPrice: number | string | null | undefined,
    qtyScale: number | null | undefined,
    unit: string | null | undefined,
    currency?: string | null,
    t?: TFunction
): string {
    const price = typeof unitPrice === 'string' ? Number(unitPrice) : (unitPrice ?? 0);
    const cur = currency || 'INR';
    if (!isMeasuredScale(qtyScale)) return formatMoney(price, cur);
    const value = ratePaise(price, qtyScale) / 100;
    // A blank or piece unit prints no "/ m" (never a guessed metre).
    const sign = t ? unitWord(unit, t) : unitSign(unit);
    return sign ? `${formatMoney(value, cur)} / ${sign}` : formatMoney(value, cur);
}

/**
 * A per-unit amount typed by staff (₹123.40 a metre) → the per-base-unit price
 * the server stores (12.34), or null when it does not split into `scale`
 * equal paise (the editor's `priceNotDivisible` rule).
 */
export function perUnitToBasePrice(perUnitAmount: number, qtyScale: number | null | undefined): number | null {
    const scale = scaleOf(qtyScale);
    const paise = toPaise(perUnitAmount);
    if (paise % scale !== 0) return null;
    return paise / scale / 100;
}

// ─── Unit cost (stock receipts; WP-44 D13) ──────────────────────────────────

/** The server keeps a unit cost per base unit with at most 4 decimals. */
export const COST_DECIMALS = 4;

/** Decimals a cost per display unit may have so the per-base-unit cost fits 4 decimals (3 at scale 10). */
export const costDecimalsFor = (qtyScale: number | null | undefined): number =>
    Math.max(0, COST_DECIMALS - decimalsFor(qtyScale));

/**
 * A cost typed per display unit ("80.00" a metre) → the per-base-unit cost the
 * server takes, as text with 4 decimals ("8.0000"), or the reason it is refused.
 * Worked in ten-thousandths of a rupee so nothing is rounded.
 */
export function parseCostPerUnit(
    text: string,
    qtyScale: number | null | undefined
): { baseCost: string } | { problem: 'format' | 'decimals' | 'comma' } {
    const read = readDecimal(text);
    if ('problem' in read) return read;
    if (read.whole.length > 10) return { problem: 'format' };
    const meaningful = read.fraction;
    if (meaningful.length > costDecimalsFor(qtyScale)) return { problem: 'decimals' };
    const scale = scaleOf(qtyScale);
    const tenThousandths = BigInt(read.whole) * 10000n + BigInt(meaningful.padEnd(COST_DECIMALS, '0') || '0');
    const base = tenThousandths / BigInt(scale);
    const whole = base / 10000n;
    const fraction = (base % 10000n).toString().padStart(COST_DECIMALS, '0');
    return { baseCost: `${whole}.${fraction}` };
}

/** A per-base-unit cost as the per-display-unit number for an input box (8.0005 at scale 10 → "80.005"). */
export function costInputText(baseCost: number | string | null | undefined, qtyScale: number | null | undefined): string {
    if (baseCost === null || baseCost === undefined || baseCost === '') return '';
    const value = typeof baseCost === 'string' ? Number(baseCost) : baseCost;
    if (!Number.isFinite(value)) return '';
    const perUnit = Math.round(value * 10000) * scaleOf(qtyScale);
    const whole = Math.floor(perUnit / 10000);
    const fraction = String(perUnit % 10000).padStart(COST_DECIMALS, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
}

/** A per-base-unit cost shown per display unit: "₹80.00 / m" (up to 4 decimals); pieces "₹45.00". */
export function formatCost(
    baseCost: number | string | null | undefined,
    qtyScale: number | null | undefined,
    unit: string | null | undefined,
    t: TFunction
): string {
    const value = typeof baseCost === 'string' ? Number(baseCost) : (baseCost ?? 0);
    if (!Number.isFinite(value)) return '—';
    const perUnit = (Math.round(value * 10000) * scaleOf(qtyScale)) / 10000;
    const money = `₹${perUnit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: COST_DECIMALS })}`;
    if (!isMeasuredScale(qtyScale)) return money;
    const word = unitWord(unit, t);
    return word ? `${money} / ${word}` : money;
}
