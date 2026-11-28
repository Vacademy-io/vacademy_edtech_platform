import type { PaymentLogEntry } from '@/types/payment-logs';

/**
 * One payment stored per course — an admission package payment split between its courses, or a
 * multi-course checkout. The grouped listing (request.group_payments) returns it as ONE entry whose
 * payment_amount is the total, with each course's share in group_lines.
 */

/** The course shares of this payment: its group_lines, or the entry itself when it stands alone. */
export const paymentShares = (entry: PaymentLogEntry | null | undefined): PaymentLogEntry[] => {
    if (!entry) return [];
    const lines = entry.group_lines;
    return lines && lines.length > 0 ? lines : [entry];
};

/** True when the payment covers more than one course share. */
export const isSplitPayment = (entry: PaymentLogEntry | null | undefined): boolean =>
    paymentShares(entry).length > 1;

/** The course names this payment paid for, in share order, without repeats or blanks. */
export const paymentCourseNames = (entry: PaymentLogEntry | null | undefined): string[] => {
    const names: string[] = [];
    for (const line of paymentShares(entry)) {
        const name = line?.user_plan?.enroll_invite?.name?.trim();
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
};
