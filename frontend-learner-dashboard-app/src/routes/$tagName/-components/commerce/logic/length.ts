/**
 * A length typed by a shopper ("2.5", "2,5", "२.५", "2.50") read against the product's scale,
 * step and ceiling. A length that cannot be cut as typed is refused, never rounded: the shopper
 * is offered the nearest lengths that can be bought instead.
 */
import type { QuantityRules } from './stock';

/** Devanagari digits (०-९, a Hindi keyboard) as 0-9. */
export const asciiDigits = (text: string): string => text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));

export type LengthCheck =
    /** Nothing typed: nothing to buy, nothing to say. */
    | { kind: 'blank' }
    /** Not a number, or 0: nothing to buy. */
    | { kind: 'format' }
    /** Can be bought as typed; base units. */
    | { kind: 'ok'; base: number }
    /** Not on the step (or finer than the scale): the nearest lengths that can be bought, base units, shortest first. */
    | { kind: 'step'; choices: number[] }
    /** More than can be bought: the most that can, base units. */
    | { kind: 'max'; max: number };

/** At most 7 digits before the point and 4 after it (trailing zeros aside): the sums stay exact. */
const NUMBER = /^(\d{0,7})(?:\.(\d*))?$/;

/**
 * Reads a typed length in whole units (metres) for a product with `qtyScale` base units in a
 * unit. A comma with no point is the decimal point ("2,5" = 2.5); trailing zeros are fine
 * ("2.50" at scale 10 is 2.5 m); "2.55" at scale 10 is not a length that can be cut.
 */
export const checkLength = (text: string, qtyScale: number, rules: QuantityRules): LengthCheck => {
    let clean = asciiDigits(text).replace(/\s+/g, '');
    if (clean === '') return { kind: 'blank' };
    if (clean.includes(',')) {
        if (clean.includes('.') || clean.indexOf(',') !== clean.lastIndexOf(',')) return { kind: 'format' };
        clean = clean.replace(',', '.');
    }
    const match = NUMBER.exec(clean);
    if (!match) return { kind: 'format' };
    const whole = match[1] || '';
    const fraction = (match[2] || '').replace(/0+$/, '');
    if (whole === '' && !match[2]) return { kind: 'format' };
    if (fraction.length > 4) return { kind: 'format' };
    const scale = Math.max(1, Math.floor(qtyScale || 1));
    const step = Math.max(1, Math.floor(rules.step || 1));
    // The typed value is numerator / denominator units; in base units it is scaled / denominator.
    const denominator = 10 ** fraction.length;
    const numerator = Number(whole || '0') * denominator + Number(fraction || '0');
    if (numerator === 0) return { kind: 'format' };
    const scaled = numerator * scale;
    const perStep = denominator * step;
    const below = Math.floor(scaled / perStep) * step;
    const max = rules.max;
    if (scaled % perStep === 0) {
        const base = scaled / denominator;
        if (max !== null && base > max) return { kind: 'max', max };
        return { kind: 'ok', base };
    }
    if (max !== null && below >= max) return { kind: 'max', max };
    const choices = [below, below + step].filter((q) => q >= step && (max === null || q <= max));
    return { kind: 'step', choices };
};
