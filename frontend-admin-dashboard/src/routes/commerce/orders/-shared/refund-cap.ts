import type { TFunction } from 'i18next';
import { formatMoney } from '@/components/design-system/money-cell';
import { round2 } from './order-format';
import type { ReturnView, StaffOrderDetail } from './order-types';

/**
 * Money limits the dialogs show before the server checks them (contract §5.7.4,
 * §5.9). The server stays the authority: its 409 REFUND_ABOVE_* /
 * RECEIPT_ABOVE_DUE carries the amount, which the dialog then shows instead.
 */

type CapDetail = Pick<StaffOrderDetail, 'refund_open' | 'refund_committed' | 'order'>;
type CapReturn = Pick<ReturnView, 'due_raised' | 'refunded'>;

/**
 * min(refund still open on the order, paid − already committed to refunds,
 * the return's credit not yet refunded), floored at 0, two decimals.
 */
export function refundCap(detail: CapDetail, returnView?: CapReturn | null): number {
    const open = detail.refund_open ?? 0;
    const paidLeft = (detail.order.amount_paid ?? 0) - (detail.refund_committed ?? 0);
    const returnLeft = returnView
        ? (returnView.due_raised ?? 0) - (returnView.refunded ?? 0)
        : Number.POSITIVE_INFINITY;
    const cap = Math.min(open, paidLeft, returnLeft);
    return Number.isFinite(cap) ? Math.max(0, round2(cap)) : 0;
}

/**
 * What the customer still owes on the order: the server's `amount_due` (net of
 * goods returned before payment, the figure the receipt is checked against);
 * total − paid only when the server sent no `amount_due`. Floored at 0.
 */
export function receiptDue(detail: Pick<StaffOrderDetail, 'order' | 'amount_due'>): number {
    const due = detail.amount_due ?? (detail.order.total ?? 0) - (detail.order.amount_paid ?? 0);
    return Math.max(0, round2(due));
}

/** Field check for a typed amount against a cap: null = fine. */
export function amountProblem(amount: number | null, cap: number): 'required' | 'positive' | 'aboveCap' | null {
    if (amount === null || !Number.isFinite(amount)) return 'required';
    if (amount <= 0) return 'positive';
    if (round2(amount) > cap) return 'aboveCap';
    return null;
}

/** "At most ₹x can be refunded on this order" (or "…on this return"). */
export function refundCapText(cap: number, forReturn: boolean, t: TFunction, currency = 'INR'): string {
    return t(forReturn ? 'orders.refund.capReturn' : 'orders.refund.cap', {
        amount: formatMoney(cap, currency),
    });
}
