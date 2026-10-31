import type { PaymentLogEntry } from '@/types/payment-logs';
import { getInstituteDefaultCurrency } from '@/utils/institute-currency';

/**
 * A currency string is usable only if it is a valid ISO 4217 code — i.e. something `Intl` can turn
 * into a ₹/$/… symbol. The `payment_log.currency` column also holds blanks and junk ('string',
 * 'N/A') written by older callers, none of which may be formatted as money.
 */
export const isRealCurrency = (currency?: string | null): boolean => {
    if (!currency || currency === 'N/A') return false;
    try {
        new Intl.NumberFormat(undefined, { style: 'currency', currency });
        return true;
    } catch {
        return false;
    }
};

/**
 * The currency a payment was actually taken in.
 *
 * `payment_log.currency` is copied from `enroll_invite.currency` at checkout, and the invite
 * payload left that blank — so a large share of rows carry '' even though the gateway order was
 * created in INR. Anything reading the column alone has to guess, and both guesses were wrong
 * somewhere: Manage Payments defaulted to USD (₹1,999 rendered as "$1,999.00") while the dashboard
 * widgets hardcoded ₹ (a genuine $40 charge rendered as "₹40"). Resolve from the plan actually
 * being paid for (then the invite), then the institute's saved default currency (Settings →
 * Payment), and return '' only when none of those is known so callers render the amount
 * without a misleading symbol.
 */
export const resolveEntryCurrency = (entry?: PaymentLogEntry | null): string => {
    const match = [
        entry?.payment_log?.currency,
        entry?.user_plan?.payment_plan_dto?.currency,
        entry?.user_plan?.enroll_invite?.currency,
        getInstituteDefaultCurrency(),
    ].find(isRealCurrency);
    // Normalised so 'inr' and 'INR' rows aggregate into one bucket on the summary cards.
    return match ? match.trim().toUpperCase() : '';
};

/**
 * Format an amount in `currency`, falling back to a plain number (prefixed with the raw code when
 * there is one) if the currency isn't a code we can render a symbol for.
 */
export const formatMoney = (
    amount: number,
    currency: string,
    options?: Intl.NumberFormatOptions
): string => {
    if (isRealCurrency(currency)) {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            ...options,
        }).format(amount);
    }
    return `${currency && currency !== 'N/A' ? currency + ' ' : ''}${amount.toLocaleString(
        undefined,
        options
    )}`;
};
