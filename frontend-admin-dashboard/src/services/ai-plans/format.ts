/**
 * Display helpers for plan prices. Every figure comes from the server (base,
 * tax and total in minor units); nothing here computes what anyone pays.
 */
import { getActiveLocale } from '@/lib/formatters';
import { AUTOPAY_MAX_DEBIT_MINOR, type PlanPrice } from './storefront';

/**
 * The Intl locale for a money amount. Rupees use the Indian region variant for
 * English and Hindi, so 1,00,000 groups the Indian way and the sign is ₹.
 */
export function moneyLocale(currency: string, locale: string): string {
    const base = (locale || 'en').split('-')[0] ?? 'en';
    if (currency === 'INR' && (base === 'en' || base === 'hi')) return `${base}-IN`;
    return locale || 'en';
}

/**
 * Minor units → "₹5,000" (whole rupees drop the paise) or "₹5,900.50".
 * Never throws: an unknown currency degrades to "XYZ 12.34".
 */
export function formatMinor(
    minor: number,
    currency = 'INR',
    locale: string = getActiveLocale()
): string {
    if (!Number.isFinite(minor)) return '';
    const major = minor / 100;
    const whole = Math.round(minor) % 100 === 0;
    const digits = whole ? 0 : 2;
    try {
        return new Intl.NumberFormat(moneyLocale(currency, locale), {
            style: 'currency',
            currency,
            currencyDisplay: 'narrowSymbol',
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        }).format(major);
    } catch {
        return `${currency} ${major.toFixed(digits)}`;
    }
}

/** The tax rate in whole percent for a label like "18% GST": server rate first, else base/tax. */
export function taxRatePct(
    price: Pick<PlanPrice, 'tax_rate_bps' | 'base_minor' | 'tax_minor'>
): number | null {
    if (price.tax_rate_bps !== null && price.tax_rate_bps >= 0) {
        return Math.round(price.tax_rate_bps) / 100;
    }
    if (price.base_minor > 0 && price.tax_minor >= 0) {
        return Math.round((price.tax_minor / price.base_minor) * 100);
    }
    return null;
}

/** Locale key for the billing period of a plan (`aiPlans:period.*`). */
export type PeriodKey = 'month' | 'quarter' | 'halfYear' | 'year' | 'months';

export function periodKey(months: number): PeriodKey {
    if (months === 1) return 'month';
    if (months === 3) return 'quarter';
    if (months === 6) return 'halfYear';
    if (months === 12) return 'year';
    return 'months';
}

/** True when one renewal costs more than an AFA-free recurring debit allows. */
export function aboveAutopayCeiling(
    totalMinor: number,
    ceilingMinor = AUTOPAY_MAX_DEBIT_MINOR
): boolean {
    return totalMinor > ceilingMinor;
}

/**
 * The plan price this institute actually pays: a custom-deal override replaces the base, and the
 * tax is re-derived at the same rate the server priced the plan at (same buyer state).
 */
export function effectivePrice(
    price: PlanPrice,
    overrideBaseMinor: number | null | undefined
): PlanPrice {
    if (
        overrideBaseMinor === null ||
        overrideBaseMinor === undefined ||
        overrideBaseMinor === price.base_minor
    ) {
        return price;
    }
    const rateBps =
        price.tax_rate_bps !== null && price.tax_rate_bps >= 0
            ? price.tax_rate_bps
            : price.base_minor > 0
              ? (price.tax_minor / price.base_minor) * 10000
              : 0;
    const tax = Math.round((overrideBaseMinor * rateBps) / 10000);
    return {
        ...price,
        base_minor: overrideBaseMinor,
        tax_minor: tax,
        total_minor: overrideBaseMinor + tax,
    };
}

type T = (key: string, vars?: Record<string, unknown>) => string;

/**
 * The two price lines on a card:
 *   headline  "₹5,000 / month + GST"
 *   inclusive "₹5,900 incl. 18% GST"
 */
export function priceLines(
    price: PlanPrice,
    periodMonths: number,
    t: T,
    locale: string = getActiveLocale()
): { headline: string; inclusive: string; period: string } {
    const pk = periodKey(periodMonths);
    const period = t(`period.${pk}`, { months: periodMonths });
    const base = formatMinor(price.base_minor, price.currency, locale);
    const total = formatMinor(price.total_minor, price.currency, locale);
    const rate = taxRatePct(price);
    const headline =
        price.tax_minor > 0
            ? t('price.perPeriodPlusGst', { price: base, period })
            : t('price.perPeriod', { price: base, period });
    const inclusive =
        price.tax_minor > 0
            ? rate !== null
                ? t('price.inclusiveRate', {
                      total,
                      rate: Number.isInteger(rate) ? String(rate) : rate.toFixed(1),
                  })
                : t('price.inclusive', { total })
            : t('price.noTax', { total });
    return { headline, inclusive, period };
}
