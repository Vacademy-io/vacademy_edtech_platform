import { describe, expect, it } from 'vitest';
import { summaryFromStatusTotals } from '../paymentSummary';
import type { PaymentStatusTotal } from '@/services/payment-logs';

const group = (over: Partial<PaymentStatusTotal>): PaymentStatusTotal => ({
    status: 'PAID',
    currency: 'INR',
    due_eligible: true,
    count: 1,
    amount: 100,
    ...over,
});

describe('summaryFromStatusTotals', () => {
    it('sums a bucket across the groups that land in it', () => {
        const summary = summaryFromStatusTotals([
            group({ count: 3, amount: 300 }),
            group({ count: 2, amount: 200, due_eligible: false }),
        ]);

        expect(summary.paid.count).toBe(5);
        expect(summary.paid.amountByCurrency.INR).toBe(500);
        // Eligibility only gates pending — paid money is paid either way.
        expect(summary.notCounted.count).toBe(0);
    });

    it('keeps currencies apart', () => {
        const summary = summaryFromStatusTotals([
            group({ count: 2, amount: 200 }),
            group({ currency: 'AED', count: 1, amount: 50 }),
        ]);

        expect(summary.paid.amountByCurrency).toEqual({ INR: 200, AED: 50 });
        expect(summary.paid.count).toBe(3);
    });

    it('files an unknown status under pending, as the row rules do', () => {
        const summary = summaryFromStatusTotals([
            group({ status: 'NOT_INITIATED', count: 4, amount: 400 }),
            group({ status: 'PAYMENT_PENDING', count: 1, amount: 100 }),
        ]);

        expect(summary.pending.count).toBe(5);
        expect(summary.pending.amountByCurrency.INR).toBe(500);
    });

    it('moves unsettled money on a dead enrolment out of pending', () => {
        const summary = summaryFromStatusTotals([
            group({ status: 'PAYMENT_PENDING', count: 2, amount: 200, due_eligible: false }),
        ]);

        expect(summary.pending.count).toBe(0);
        expect(summary.notCounted.count).toBe(2);
        // Still money the institute billed, so it stays in the headline total.
        expect(summary.total.count).toBe(2);
    });

    it('leaves cancelled money out of every bucket, including the total', () => {
        const summary = summaryFromStatusTotals([
            group({ count: 1, amount: 100 }),
            group({ status: 'CANCELLED', count: 9, amount: 9000 }),
        ]);

        expect(summary.total.count).toBe(1);
        expect(summary.total.amountByCurrency.INR).toBe(100);
    });

    it('separates failed from abandoned', () => {
        const summary = summaryFromStatusTotals([
            group({ status: 'FAILED', count: 2, amount: 200 }),
            group({ status: 'ABANDONED', count: 3, amount: 300 }),
        ]);

        expect(summary.failed.count).toBe(2);
        expect(summary.abandoned.count).toBe(3);
        expect(summary.total.count).toBe(5);
    });

    it('files a zero-amount group under its bucket without inventing a currency total', () => {
        const summary = summaryFromStatusTotals([group({ count: 2, amount: 0, currency: '' })]);

        expect(summary.paid.count).toBe(2);
        expect(summary.paid.amountByCurrency).toEqual({});
    });
});
