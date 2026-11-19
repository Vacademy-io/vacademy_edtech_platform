import type { TFunction } from 'i18next';
import { formatMoney } from '@/components/design-system/money-cell';
import { round2 } from './order-format';
import type { ReturnPreview, ReturnView, StaffOrderDetail } from './order-types';

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

type DueDetail = Pick<StaffOrderDetail, 'order' | 'amount_due'>;

/**
 * A staff order left on credit that still owes (contract §15): channel ADMIN,
 * not cash on delivery, unpaid or part paid, something due. A return on it is
 * allowed; its credit first lowers what is owed. Online and counter orders
 * keep their own rules (returned once paid).
 */
export function owesOnCredit(detail: DueDetail): boolean {
    const order = detail.order;
    const status = (order.payment_status ?? '').toUpperCase();
    return (
        (order.channel ?? '').toUpperCase() === 'ADMIN' &&
        (order.payment_method ?? '').toUpperCase() !== 'COD' &&
        (status === 'UNPAID' || status === 'PARTIALLY_PAID') &&
        receiptDue(detail) > 0
    );
}

/**
 * How much goods returned before payment took off what is owed: total − paid −
 * the server's `amount_due` (0 when the server sent no `amount_due`).
 */
export function dueLoweredByReturns(detail: DueDetail): number {
    if (detail.amount_due === null || detail.amount_due === undefined) return 0;
    const lowered = (detail.order.total ?? 0) - (detail.order.amount_paid ?? 0) - detail.amount_due;
    return Math.max(0, round2(lowered));
}

/**
 * Where a return's credit goes on an order that still owes (§15): first off
 * what is owed, only the part above it paid back. An estimate for the dialog;
 * the server books it.
 */
export function creditSplit(credit: number, due: number): { offDue: number; paidBack: number } {
    const offDue = Math.max(0, Math.min(credit, due));
    return { offDue: round2(offDue), paidBack: Math.max(0, round2(credit - offDue)) };
}

type SplitPreview = Pick<ReturnPreview, 'credit_estimate'> &
    Partial<Pick<ReturnPreview, 'credit_to_due' | 'refund_amount'>>;

/**
 * The split the return dialog shows. The server's own split (`credit_to_due`,
 * `refund_amount`) wins when the preview carries it; the screen's estimate
 * (`creditSplit` of the estimate against what is owed) is the fallback for an
 * order that owes. null = nothing to split (an order that owes nothing, and
 * the server put nothing off a due).
 */
export function previewSplit(
    preview: SplitPreview | null | undefined,
    owing: boolean,
    due: number
): { offDue: number; paidBack: number } | null {
    if (!preview) return null;
    const toDue = preview.credit_to_due;
    const back = preview.refund_amount;
    if (toDue !== null && toDue !== undefined && back !== null && back !== undefined) {
        if (!owing && toDue <= 0) return null;
        return { offDue: round2(Math.max(0, toDue)), paidBack: round2(Math.max(0, back)) };
    }
    if (!owing || preview.credit_estimate === null) return null;
    return creditSplit(preview.credit_estimate, due);
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
