/**
 * Money and quantities as a shopper reads them: Latin digits in
 * both languages, Indian digit grouping (₹1,23,456), no decimals on a whole amount. Written by
 * hand so the result does not depend on the ICU data of the visitor's browser.
 */

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

/** The price of a quantity in base units, given the price of ONE base unit. */
export const lineAmount = (unitPrice: unknown, baseUnits: number): number | null => {
    const price = toFiniteNumber(unitPrice);
    if (price === null) return null;
    return Math.round(price * baseUnits * 100) / 100;
};

/** The price of one whole unit (a metre) from the price of one base unit (10 cm). */
export const perUnitAmount = (unitPrice: unknown, qtyScale: number): number | null =>
    lineAmount(unitPrice, Math.max(1, Math.floor(qtyScale || 1)));
