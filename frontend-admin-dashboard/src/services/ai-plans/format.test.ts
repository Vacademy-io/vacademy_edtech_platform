import { describe, expect, it } from 'vitest';
import aiPlansEn from '../../../public/locales/en/aiPlans.json';
import {
    aboveAutopayCeiling,
    effectivePrice,
    formatMinor,
    moneyLocale,
    periodKey,
    priceLines,
    taxRatePct,
} from './format';
import type { PlanPrice } from './storefront';

/** Real en catalogue, so a missing key shows up as the raw key. */
function t(key: string, vars?: Record<string, unknown>): string {
    const value = key.split('.').reduce<unknown>((node, part) => {
        if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
        return undefined;
    }, aiPlansEn as unknown);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
}

const price = (over: Partial<PlanPrice> = {}): PlanPrice => ({
    currency: 'INR',
    base_minor: 500_000,
    tax_minor: 90_000,
    total_minor: 590_000,
    tax_rate_bps: 1800,
    tax_label: '18% GST',
    ...over,
});

describe('formatMinor', () => {
    it('renders rupees with the ₹ sign and drops whole paise', () => {
        expect(formatMinor(500_000, 'INR', 'en')).toBe('₹5,000');
        expect(formatMinor(590_000, 'INR', 'en')).toBe('₹5,900');
    });

    it('keeps paise when there are any', () => {
        expect(formatMinor(590_050, 'INR', 'en')).toBe('₹5,900.50');
        expect(formatMinor(1, 'INR', 'en')).toBe('₹0.01');
    });

    it('groups rupees the Indian way (lakh) for English', () => {
        expect(formatMinor(10_000_000, 'INR', 'en')).toBe('₹1,00,000');
        expect(formatMinor(1_500_000, 'INR', 'en')).toBe('₹15,000');
    });

    it('never throws: bad input or an unknown currency degrade quietly', () => {
        expect(formatMinor(Number.NaN, 'INR', 'en')).toBe('');
        expect(formatMinor(1234, 'NOT-A-CURRENCY', 'en')).toBe('NOT-A-CURRENCY 12.34');
    });

    it('uses the Indian region only for rupees in en/hi', () => {
        expect(moneyLocale('INR', 'en')).toBe('en-IN');
        expect(moneyLocale('INR', 'hi')).toBe('hi-IN');
        expect(moneyLocale('INR', 'fr')).toBe('fr');
        expect(moneyLocale('USD', 'en')).toBe('en');
    });
});

describe('taxRatePct', () => {
    it('prefers the server rate, else derives it from base and tax', () => {
        expect(taxRatePct(price())).toBe(18);
        expect(taxRatePct(price({ tax_rate_bps: null }))).toBe(18);
        expect(taxRatePct(price({ tax_rate_bps: 0, tax_minor: 0 }))).toBe(0);
        expect(taxRatePct(price({ tax_rate_bps: null, base_minor: 0, tax_minor: 0 }))).toBeNull();
    });
});

describe('priceLines', () => {
    it('headline is "₹X / month + GST" and the inclusive line carries the total', () => {
        const lines = priceLines(price(), 1, t, 'en');
        expect(lines.headline).toBe('₹5,000 / month + GST');
        expect(lines.inclusive).toBe('₹5,900 incl. 18% GST');
        expect(lines.period).toBe('month');
    });

    it('names longer periods', () => {
        expect(priceLines(price(), 12, t, 'en').headline).toBe('₹5,000 / year + GST');
        expect(priceLines(price(), 3, t, 'en').headline).toBe('₹5,000 / quarter + GST');
        expect(priceLines(price(), 2, t, 'en').headline).toBe('₹5,000 / 2 months + GST');
    });

    it('without GST (export / zero-rated) there is no "+ GST" and no rate', () => {
        const lines = priceLines(
            price({ tax_minor: 0, total_minor: 500_000, tax_rate_bps: 0 }),
            1,
            t,
            'en'
        );
        expect(lines.headline).toBe('₹5,000 / month');
        expect(lines.inclusive).toBe('₹5,000 in total');
    });

    it('shows the server total as is, never recomputing it', () => {
        // Total deliberately not base + 18%: the card must print what the server charges.
        const lines = priceLines(price({ total_minor: 590_001, tax_minor: 90_001 }), 1, t, 'en');
        expect(lines.inclusive).toBe('₹5,900.01 incl. 18% GST');
    });

    it('falls back to "incl. GST" when no rate is known', () => {
        const lines = priceLines(
            price({ tax_rate_bps: null, base_minor: 0, tax_minor: 100, total_minor: 100 }),
            1,
            t,
            'en'
        );
        expect(lines.inclusive).toBe('₹1 incl. GST');
    });
});

describe('periodKey / aboveAutopayCeiling', () => {
    it('maps months to period keys', () => {
        expect(periodKey(1)).toBe('month');
        expect(periodKey(6)).toBe('halfYear');
        expect(periodKey(12)).toBe('year');
        expect(periodKey(5)).toBe('months');
    });

    it('Rs 15,000 is the AFA-free ceiling: equal is fine, a paisa more is not', () => {
        expect(aboveAutopayCeiling(1_500_000)).toBe(false);
        expect(aboveAutopayCeiling(1_500_001)).toBe(true);
        expect(aboveAutopayCeiling(1_000_000, 500_000)).toBe(true);
    });
});

describe('effectivePrice', () => {
    const pro: PlanPrice = {
        currency: 'INR',
        base_minor: 500_000,
        tax_minor: 90_000,
        total_minor: 590_000,
        tax_rate_bps: 1800,
        tax_label: 'CGST 9% + SGST 9%',
    };

    it('keeps the plan price without an override', () => {
        expect(effectivePrice(pro, null)).toBe(pro);
        expect(effectivePrice(pro, undefined)).toBe(pro);
    });

    it('reprices a custom deal at the same tax rate', () => {
        expect(effectivePrice(pro, 1000)).toEqual({
            ...pro,
            base_minor: 1000,
            tax_minor: 180,
            total_minor: 1180,
        });
    });

    it('derives the rate from base/tax when the server sent none', () => {
        const p = effectivePrice({ ...pro, tax_rate_bps: null }, 250_000);
        expect(p.tax_minor).toBe(45_000);
        expect(p.total_minor).toBe(295_000);
    });

    it('headline shows the deal price', () => {
        expect(priceLines(effectivePrice(pro, 1000), 1, t).headline).toContain('10');
    });
});
