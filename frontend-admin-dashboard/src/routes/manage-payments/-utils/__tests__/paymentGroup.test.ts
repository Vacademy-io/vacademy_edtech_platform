import { describe, expect, it } from 'vitest';
import type { PaymentLogEntry } from '@/types/payment-logs';
import { isSplitPayment, paymentCourseNames, paymentShares } from '../paymentGroup';

const entry = (id: string, amount: number, course?: string, lines?: PaymentLogEntry[]) =>
    ({
        payment_log: { id, payment_amount: amount },
        user_plan: course ? { enroll_invite: { name: course } } : null,
        current_payment_status: 'PAID',
        group_lines: lines,
    }) as unknown as PaymentLogEntry;

describe('paymentGroup', () => {
    it('a payment on its own is its only share', () => {
        const single = entry('a', 700, 'Course A');
        expect(paymentShares(single)).toEqual([single]);
        expect(isSplitPayment(single)).toBe(false);
        expect(paymentCourseNames(single)).toEqual(['Course A']);
    });

    it('an ungrouped listing (no group_lines) and a one-line group read the same', () => {
        const a = entry('a', 700, 'Course A');
        expect(isSplitPayment(entry('a', 700, 'Course A', []))).toBe(false);
        expect(isSplitPayment(entry('a', 700, 'Course A', [a]))).toBe(false);
    });

    it('a package payment lists every course once, in order', () => {
        const a = entry('a', 3000, 'Course A');
        const b = entry('b', 2000, 'Course B');
        const c = entry('c', 1000, 'Course A');
        const row = entry('a', 6000, 'Course A', [a, b, c]);
        expect(isSplitPayment(row)).toBe(true);
        expect(paymentShares(row)).toHaveLength(3);
        expect(paymentCourseNames(row)).toEqual(['Course A', 'Course B']);
    });

    it('is safe on missing data', () => {
        expect(paymentShares(null)).toEqual([]);
        expect(isSplitPayment(undefined)).toBe(false);
        expect(paymentCourseNames(entry('x', 1))).toEqual([]);
    });
});
