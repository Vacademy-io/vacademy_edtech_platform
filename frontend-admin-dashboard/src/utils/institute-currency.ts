/**
 * The currency for money that belongs to the institute but carries no currency of its own —
 * outstanding fees, dues, overdue balances. The fee ledger (`student_fee_payment`) has no currency
 * column at all, so these figures used to be printed with a hardcoded ₹, which is simply wrong for
 * a UAE or US institute.
 *
 * Resolution: the institute's configured default currency (Settings → Payment, stored as
 * PAYMENT_SETTING.data.defaultCurrency) wins; then what the Institute entity already documents —
 * the manual `currency` override, otherwise derive from `country`. When neither is set we return '' and the caller renders a
 * bare number — an unsymbolled amount is ambiguous, a wrongly-symbolled one is false.
 *
 * NOT for payments: a payment_log row knows the currency it was actually charged in, so those must
 * go through `resolveEntryCurrency` in `payment-currency.ts` instead.
 */

/**
 * Country label -> ISO 4217. Keyed on the free-text values `institutes.country` actually holds
 * (it is an unconstrained varchar filled by onboarding), matched case-insensitively.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
    india: 'INR',
    ind: 'INR',
    in: 'INR',
    'united arab emirates': 'AED',
    uae: 'AED',
    ae: 'AED',
    'united states': 'USD',
    'united states of america': 'USD',
    usa: 'USD',
    us: 'USD',
    'united kingdom': 'GBP',
    uk: 'GBP',
    gb: 'GBP',
    australia: 'AUD',
    au: 'AUD',
    canada: 'CAD',
    ca: 'CAD',
    singapore: 'SGD',
    sg: 'SGD',
    'south africa': 'ZAR',
    za: 'ZAR',
    'new zealand': 'NZD',
    nz: 'NZD',
};

import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

export interface InstituteCurrencySource {
    /** Manual override (institutes.currency). Takes precedence over `country`. */
    currency?: string | null;
    /** Free-text country from onboarding (institutes.country). */
    country?: string | null;
    /** Raw institutes.setting_json — PAYMENT_SETTING.data.defaultCurrency is read from it. */
    setting?: string | null;
}

const isCurrencyCode = (value: unknown): value is string =>
    typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim());

/** PAYMENT_SETTING.data.defaultCurrency out of the raw setting JSON, upper-cased, or ''. */
export const readPaymentSettingCurrency = (setting?: string | null): string => {
    if (!setting) return '';
    try {
        const value = JSON.parse(setting)?.setting?.PAYMENT_SETTING?.data?.defaultCurrency;
        return isCurrencyCode(value) ? value.trim().toUpperCase() : '';
    } catch {
        return '';
    }
};

/**
 * @returns an ISO 4217 code, or '' when the institute's currency cannot be determined — callers
 * must then render the amount without a symbol rather than guessing one.
 */
export const resolveInstituteCurrency = (institute?: InstituteCurrencySource | null): string => {
    const configured = readPaymentSettingCurrency(institute?.setting);
    if (configured) {
        return configured;
    }
    const override = institute?.currency?.trim();
    // Only trust a well-formed code; the column is a free varchar and has held junk before.
    if (override && /^[A-Za-z]{3}$/.test(override)) {
        return override.toUpperCase();
    }
    const country = institute?.country?.trim().toLowerCase();
    if (country && COUNTRY_CURRENCY[country]) {
        return COUNTRY_CURRENCY[country];
    }
    return '';
};

/**
 * The current institute's currency (see `resolveInstituteCurrency`), read from the loaded
 * institute details. For non-React code; components can call it too, it is a cheap read.
 */
export const getInstituteDefaultCurrency = (): string =>
    resolveInstituteCurrency(useInstituteDetailsStore.getState().instituteDetails);

/**
 * The fallback for money shown without a currency of its own (a plan with none, a payment
 * record with none): the institute's currency, else INR — the platform's historical default.
 */
export const fallbackCurrency = (): string => getInstituteDefaultCurrency() || 'INR';

/**
 * Compact notation follows the LOCALE, not the currency, so formatting everything as en-IN turned
 * a US institute's $125,000 into "$1L". Use the Indian convention (L/Cr) only for rupees.
 */
const localeFor = (currency: string): string => (currency === 'INR' ? 'en-IN' : 'en-US');

/**
 * Render a dues/outstanding amount in the institute's currency, or as a bare number when
 * `currency` is '' (see above — never substitute a guess).
 */
export const formatInstituteMoney = (
    amount: number,
    currency: string,
    options?: { compact?: boolean }
): string => {
    // Compact by default only once the number is long enough to need it (1L / 100K+).
    const useCompact = options?.compact ?? amount >= 100000;
    const notation = useCompact ? 'compact' : 'standard';
    const locale = localeFor(currency);
    if (currency) {
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency,
                maximumFractionDigits: 0,
                notation,
            }).format(amount);
        } catch {
            /* unknown code — fall through to the plain-number form */
        }
    }
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, notation }).format(amount);
};
