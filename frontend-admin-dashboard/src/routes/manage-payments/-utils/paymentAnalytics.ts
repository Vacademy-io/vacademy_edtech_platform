import type { PaymentLogEntry } from '@/types/payment-logs';
import { isRealCurrency, resolveEntryCurrency } from '@/utils/payment-currency';
import { derivePaymentTypeLabel } from './exportPaymentLogsCsv';
import { classifyEntry, isCancelledEntry, isDueEligibleEntry } from './paymentSummary';
import { paymentReceivedAt } from './paymentReceivedAt';

/**
 * Dashboard analytics derived entirely client-side from the payment-logs set the Manage Payments
 * page already fetches (all filtered rows). This keeps every panel backed by REAL data — no
 * separate analytics endpoint exists yet, so anything that can't be derived from a payment row
 * (bank settlements, gateway success-rate %, decline reasons) is deliberately left out rather than
 * faked. Amounts are summed in a single "primary" currency (the most common real code in the set,
 * with blank/unresolved rows folded in — see resolveEntryCurrency) so a stray foreign charge can't
 * corrupt the totals.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bucketing is shared with the KPI cards so the two can never disagree about what's in flight. */
const normStatus = (entry: PaymentLogEntry): 'PAID' | 'FAILED' | 'ABANDONED' | 'PENDING' => {
    const bucket = classifyEntry(entry);
    if (bucket === 'paid') return 'PAID';
    if (bucket === 'failed') return 'FAILED';
    if (bucket === 'abandoned') return 'ABANDONED';
    return 'PENDING';
};

/** When the payment counts as received, so a back-dated entry charts under its payment date. */
const entryTime = (entry: PaymentLogEntry): number | null => {
    const raw = paymentReceivedAt(entry.payment_log).value;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? null : t;
};

/**
 * What to file a payment's revenue under. Normally the course/membership it was taken for, but an
 * admin-raised invoice has no enrolment behind it (user_plan_id is NULL) and so has no invite name
 * — those were being grouped as "Unlabelled", which tells the reader nothing. Fall back to what the
 * payment actually is ("User Invoice").
 */
const revenueLabel = (entry: PaymentLogEntry): string => {
    const name = entry.user_plan?.enroll_invite?.name?.trim();
    return name && name.length ? name : derivePaymentTypeLabel(entry);
};

/** The vendor string, normalised for grouping. Blank vendors collapse to "Other". */
const vendorLabel = (entry: PaymentLogEntry): string => {
    const v = entry.payment_log?.vendor?.trim();
    return v && v.length ? v : 'Other';
};

export interface AmountSlice {
    label: string;
    amount: number;
    count: number;
}

export interface AgingBucket {
    label: string;
    amount: number;
    count: number;
    /** Severity drives the token colour used in the UI. */
    tone: 'neutral' | 'warning' | 'strong' | 'danger';
}

export interface FunnelStage {
    label: string;
    amount: number;
    count: number;
    hint: string;
}

export interface PaymentAnalytics {
    primaryCurrency: string;
    totalEntries: number;
    collected: { amount: number; count: number };
    outstanding: { amount: number; count: number };
    failed: { amount: number; count: number };
    /** Paid ÷ (paid + failed), by count. null when there were no settled/failed attempts. */
    successRate: number | null;
    /** Share of SUCCESSFUL payments by method/vendor, largest first. */
    methodMix: AmountSlice[];
    /** Collected amount by gateway/vendor, largest first. */
    gatewayBreakdown: AmountSlice[];
    /** Collected revenue by course / membership (enroll invite), largest first. */
    topCourses: AmountSlice[];
    /** Count of payments by high-level payment type. */
    paymentTypeMix: AmountSlice[];
    /** Outstanding (pending) amount bucketed by how long it has been unpaid. */
    aging: AgingBucket[];
    /** Invoiced → attempted → succeeded, by amount. */
    funnel: FunnelStage[];
}

/** Most common real currency code in the set (falls back to '' when none is resolvable). */
const pickPrimaryCurrency = (entries: PaymentLogEntry[]): string => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
        const c = resolveEntryCurrency(e);
        if (isRealCurrency(c)) counts[c] = (counts[c] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted.length ? sorted[0]![0] : '';
};

const topSlices = (map: Record<string, AmountSlice>, limit?: number): AmountSlice[] => {
    const slices = Object.values(map).sort((a, b) => b.amount - a.amount || b.count - a.count);
    return typeof limit === 'number' ? slices.slice(0, limit) : slices;
};

export const computePaymentAnalytics = (allEntries: PaymentLogEntry[]): PaymentAnalytics => {
    // Voided invoices are dropped up front, exactly as the KPI cards drop them. The bucketing
    // below is shared with those cards, so letting a cancelled row through here would have it
    // counted as still-due in the dashboard while the cards ignored it.
    const entries = allEntries.filter((entry) => !isCancelledEntry(entry));
    const primaryCurrency = pickPrimaryCurrency(entries);

    // Only fold an amount into the running totals when it was taken in the primary currency (or an
    // unresolved/blank one, which is overwhelmingly the primary currency in practice). Counts are
    // currency-agnostic and always included.
    const amountCounts = (entry: PaymentLogEntry): boolean => {
        if (!primaryCurrency) return true;
        const c = resolveEntryCurrency(entry);
        return !isRealCurrency(c) || c === primaryCurrency;
    };
    const amountOf = (entry: PaymentLogEntry): number =>
        amountCounts(entry) ? entry.payment_log?.payment_amount || 0 : 0;

    const collected = { amount: 0, count: 0 };
    const outstanding = { amount: 0, count: 0 };
    const failed = { amount: 0, count: 0 };
    // Unsettled records that will never settle: on a dead enrolment, or a checkout whose gateway
    // order expired unfinished (ABANDONED). Kept out of `outstanding` (nobody owes this) and out
    // of the ageing — a cart abandoned a month ago is not "30+ days overdue" — but held here so
    // the funnel's "Invoiced" stage still totals every record it says it counts.
    const notDue = { amount: 0, count: 0 };

    const methodMix: Record<string, AmountSlice> = {};
    const gatewayBreakdown: Record<string, AmountSlice> = {};
    const topCourses: Record<string, AmountSlice> = {};
    const paymentTypeMix: Record<string, AmountSlice> = {};

    const agingDefs: AgingBucket[] = [
        { label: '0–7 days', amount: 0, count: 0, tone: 'neutral' },
        { label: '8–15 days', amount: 0, count: 0, tone: 'warning' },
        { label: '16–30 days', amount: 0, count: 0, tone: 'strong' },
        { label: '30+ days', amount: 0, count: 0, tone: 'danger' },
    ];
    const now = Date.now();

    let attemptedAmount = 0;
    let attemptedCount = 0;

    for (const entry of entries) {
        const status = normStatus(entry);
        const amount = amountOf(entry);

        const bump = (map: Record<string, AmountSlice>, key: string) => {
            const slice = (map[key] ??= { label: key, amount: 0, count: 0 });
            slice.amount += amount;
            slice.count += 1;
        };

        // Abandoned never reached the gateway either — the order was created, nobody paid.
        if (status !== 'PENDING' && status !== 'ABANDONED') {
            attemptedAmount += amount;
            attemptedCount += 1;
        }

        if (status === 'PAID') {
            collected.amount += amount;
            collected.count += 1;
            bump(methodMix, vendorLabel(entry));
            bump(gatewayBreakdown, vendorLabel(entry));
            bump(topCourses, revenueLabel(entry));
        } else if (status === 'FAILED') {
            failed.amount += amount;
            failed.count += 1;
        } else if (status === 'ABANDONED' || !isDueEligibleEntry(entry)) {
            // Unsettled, but never going to be collected — an expired checkout, or a record
            // hanging off a cancelled/terminated/expired enrolment. Neither outstanding nor worth
            // ageing. Still a payment record, so it stays in the funnel.
            notDue.amount += amount;
            notDue.count += 1;
        } else {
            outstanding.amount += amount;
            outstanding.count += 1;
            const t = entryTime(entry);
            if (t != null) {
                const ageDays = Math.max(0, Math.floor((now - t) / DAY_MS));
                const idx = ageDays <= 7 ? 0 : ageDays <= 15 ? 1 : ageDays <= 30 ? 2 : 3;
                agingDefs[idx]!.amount += amount;
                agingDefs[idx]!.count += 1;
            }
        }

        bump(paymentTypeMix, derivePaymentTypeLabel(entry));
    }

    const settledAttempts = collected.count + failed.count;
    const successRate = settledAttempts > 0 ? collected.count / settledAttempts : null;

    const funnel: FunnelStage[] = [
        {
            label: 'Invoiced',
            // Every record, dead enrolments included — `count` is entries.length, so the amount has
            // to span the same set or the stage contradicts itself.
            amount: collected.amount + outstanding.amount + notDue.amount + failed.amount,
            count: entries.length,
            hint: 'All payment records in view',
        },
        {
            label: 'Attempted',
            amount: attemptedAmount,
            count: attemptedCount,
            hint: 'Reached the gateway',
        },
        {
            label: 'Succeeded',
            amount: collected.amount,
            count: collected.count,
            hint: 'Captured / settled',
        },
    ];

    return {
        primaryCurrency,
        totalEntries: entries.length,
        collected,
        outstanding,
        failed,
        successRate,
        methodMix: topSlices(methodMix),
        gatewayBreakdown: topSlices(gatewayBreakdown),
        topCourses: topSlices(topCourses, 6),
        paymentTypeMix: topSlices(paymentTypeMix),
        aging: agingDefs,
        funnel,
    };
};
