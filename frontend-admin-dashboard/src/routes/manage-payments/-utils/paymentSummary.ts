import type { PaymentLogEntry } from '@/types/payment-logs';
import type { PaymentStatusTotal } from '@/services/payment-logs';
import { formatMoney, isRealCurrency, resolveEntryCurrency } from '@/utils/payment-currency';

/** A single KPI bucket: how many payments and their total amount, split by currency. */
export interface StatBucket {
    count: number;
    amountByCurrency: Record<string, number>;
}

export interface PaymentSummary {
    total: StatBucket;
    paid: StatBucket;
    /**
     * Unsettled records on a LIVE enrolment that are still young enough to complete — money
     * genuinely in flight at the gateway. Backs the "Payment pending" card.
     */
    pending: StatBucket;
    /**
     * Checkouts opened and never finished: PAYMENT_PENDING rows older than the gateway's order
     * TTL (the server reports them as ABANDONED). Nobody got access and nothing is owed, so they
     * sit in neither Pending nor Due — they are a leads signal, not a finance one.
     */
    abandoned: StatBucket;
    failed: StatBucket;
    /**
     * Unsettled records on a cancelled / terminated / expired enrolment. Deliberately in NO card:
     * this money will never arrive, so showing it as pending or due overstated both. The rows stay
     * in the table under "All" for audit.
     */
    notCounted: StatBucket;
}

const emptyBucket = (): StatBucket => ({ count: 0, amountByCurrency: {} });

export const emptyPaymentSummary = (): PaymentSummary => ({
    total: emptyBucket(),
    paid: emptyBucket(),
    pending: emptyBucket(),
    abandoned: emptyBucket(),
    failed: emptyBucket(),
    notCounted: emptyBucket(),
});

const addToBucket = (bucket: StatBucket, amount: number, currency: string) => {
    bucket.count += 1;
    if (amount) {
        const key = currency || 'N/A';
        bucket.amountByCurrency[key] = (bucket.amountByCurrency[key] || 0) + amount;
    }
};

/** Which KPI bucket a single payment falls into. */
export type PaymentBucketKey = 'paid' | 'pending' | 'abandoned' | 'failed';

/**
 * Enrolment statuses on which an unfinished payment can still complete. ACTIVE (a renewal or
 * instalment on a live plan) and PENDING_FOR_PAYMENT (the checkout that would activate it) — the
 * server's ABANDONED rule handles the age; this handles the plan.
 *
 * A whitelist of the live statuses, deliberately not a blacklist of the dead ones: production
 * carries CANCELED *and* CANCELLED, plus TERMINATED, EXPIRED, DELETED, INACTIVE, PAYMENT_FAILED
 * and the typo PENDING_FOR_PAYMNET, so a blacklist would quietly start counting whichever status
 * somebody adds next.
 */
const LIVE_PLAN_STATUSES = new Set(['ACTIVE', 'PENDING_FOR_PAYMENT']);

/**
 * Can this unsettled row still turn into money?
 *
 * On a cancelled, terminated or expired enrolment it cannot: nobody will complete a checkout for
 * access they no longer have, and counting it reported a gateway backlog that would never clear
 * (Suchbliss showed ₹19,201 of them against ₹7,241 of real pending). Rows with no user_plan stay
 * eligible — they are admin-raised invoices, which the server tracks as obligations of their own.
 */
export const isDueEligibleEntry = (entry: PaymentLogEntry): boolean => {
    const status = entry.user_plan?.status;
    if (!status) return true;
    return LIVE_PLAN_STATUSES.has(status.trim().toUpperCase());
};

/**
 * A voided (REJECTED) invoice, or a payment an admin voided because it was recorded by mistake
 * (the server reports those as CANCELLED too). Either stays visible in the table for audit, but
 * is deliberately absent from every total: cancelled money was never collected and is no longer
 * owed.
 */
export const isCancelledEntry = (entry: PaymentLogEntry): boolean =>
    (entry.current_payment_status || '').toUpperCase() === 'CANCELLED' ||
    (entry.payment_log?.payment_status || '').toUpperCase() === 'VOIDED';

/**
 * Classify one payment record. "pending" absorbs PAYMENT_PENDING, NOT_INITIATED, null and any
 * other non-paid/non-failed status — which is why the Pending tile filters the table here rather
 * than through the API: `payment_status IN (...)` can never match a NULL row. ABANDONED is the
 * server's verdict on a PAYMENT_PENDING row too old to complete.
 */
export const classifyEntry = (entry: PaymentLogEntry): PaymentBucketKey => {
    const status = (
        entry.current_payment_status ||
        entry.payment_log?.payment_status ||
        ''
    ).toUpperCase();
    if (status === 'PAID') return 'paid';
    if (status === 'FAILED') return 'failed';
    if (status === 'ABANDONED') return 'abandoned';
    return 'pending';
};

/** Aggregate a set of payment entries into Total / Paid / Pending / Abandoned / Failed buckets. */
export const computePaymentSummary = (entries: PaymentLogEntry[]): PaymentSummary => {
    const summary = emptyPaymentSummary();

    for (const entry of entries) {
        if (isCancelledEntry(entry)) continue;

        const amount = entry.payment_log?.payment_amount || 0;
        const currency = resolveEntryCurrency(entry);

        const bucket = classifyEntry(entry);
        addToBucket(summary.total, amount, currency);

        // An unsettled record on a dead enrolment is money that will never arrive. It belongs in
        // no card — counting it as "pending" overstated the gateway backlog.
        if (bucket === 'pending' && !isDueEligibleEntry(entry)) {
            addToBucket(summary.notCounted, amount, currency);
            continue;
        }

        addToBucket(summary[bucket], amount, currency);
    }

    return summary;
};

/**
 * The same aggregation as {@link computePaymentSummary}, but from the server's pre-grouped totals
 * instead of the rows themselves — so the tiles describe every row matching the filters while the
 * table only ever downloads one page.
 *
 * The server classifies each row exactly as the row mapper does (a FAILED payment superseded by an
 * ACTIVE plan reads PAID, a stale PAYMENT_PENDING reads ABANDONED, a voided one reads CANCELLED),
 * so the bucket rules below are the row-level rules applied to whole groups.
 */
export const summaryFromStatusTotals = (totals: PaymentStatusTotal[]): PaymentSummary => {
    const summary = emptyPaymentSummary();

    for (const group of totals) {
        const status = (group.status || '').toUpperCase();
        // Cancelled money was never collected and is no longer owed: it sits in no card.
        if (status === 'CANCELLED') continue;

        const add = (bucket: StatBucket) => {
            bucket.count += group.count;
            if (group.amount) {
                const key = group.currency || 'N/A';
                bucket.amountByCurrency[key] = (bucket.amountByCurrency[key] || 0) + group.amount;
            }
        };

        const bucket: PaymentBucketKey =
            status === 'PAID'
                ? 'paid'
                : status === 'FAILED'
                  ? 'failed'
                  : status === 'ABANDONED'
                    ? 'abandoned'
                    : 'pending';

        add(summary.total);

        // An unsettled record on a dead enrolment is money that will never arrive.
        if (bucket === 'pending' && !group.due_eligible) {
            add(summary.notCounted);
            continue;
        }

        add(summary[bucket]);
    }

    return summary;
};

/** Card amounts are whole units — the paise/cents tail is noise at KPI altitude. */
const formatBucketMoney = (amount: number, currency: string): string =>
    formatMoney(amount, currency, { maximumFractionDigits: 0 });

/**
 * The amount a bucket actually shows on a card: recognized currencies only, summed. Used for the
 * "x% of the total" figure — a ratio, so folding a rare foreign charge into it is harmless, while
 * a count-based share would be badly misleading on institutes whose free (₹0) enrolments outnumber
 * their paid ones.
 */
export const bucketAmountTotal = (amountByCurrency: Record<string, number>): number =>
    Object.entries(amountByCurrency)
        .filter(([currency]) => isRealCurrency(currency))
        .reduce((sum, [, amount]) => sum + amount, 0);

export interface BucketAmountSummary {
    /** Amounts in recognized currencies, joined (e.g. "₹13,000" or "₹13,000 + $40"). '' if none. */
    display: string;
    /** Full breakdown incl. blank/unknown currencies, for a hover tooltip. */
    full: string;
}

/**
 * Summarize a bucket's amount for display. Only amounts in a recognized currency are shown on the
 * card (so blank/garbage currency codes in the data don't produce confusing bare numbers). The full
 * breakdown — including unknown-currency amounts — is kept for a tooltip.
 */
export const summarizeBucketAmount = (
    amountByCurrency: Record<string, number>
): BucketAmountSummary => {
    const entries = Object.entries(amountByCurrency).sort((a, b) => b[1] - a[1]);
    const display = entries
        .filter(([currency]) => isRealCurrency(currency))
        .map(([currency, amount]) => formatBucketMoney(amount, currency))
        .join(' + ');
    const full = entries
        .map(([currency, amount]) => formatBucketMoney(amount, currency))
        .join(' + ');
    return { display, full };
};
