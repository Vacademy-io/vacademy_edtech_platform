/** F4: the refund cap and its sentence, and what a receipt may take. */
import { AxiosError } from 'axios';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '@/components/design-system/money-cell';
import { detailFixture } from './order-fixtures';
import { readOrderError } from './order-errors';
import { amountProblem, receiptDue, refundCap, refundCapText } from './refund-cap';

const t = ((key: string, options?: { amount?: string }) => `${key}|${options?.amount ?? ''}`) as unknown as TFunction;

const paid = (money: Record<string, unknown>, order: Record<string, unknown> = {}) =>
    detailFixture(money, { status: 'DELIVERED', payment_status: 'PAID', amount_paid: '1200.00', ...order });

describe('refundCap', () => {
    it('is the least of refund open, paid less committed, and the return left', () => {
        const detail = paid({ refund_open: '500.00', refund_committed: '800.00' });
        expect(refundCap(detail)).toBe(400);
        expect(refundCap(paid({ refund_open: '300.00', refund_committed: 0 }))).toBe(300);
        expect(refundCap(paid({ refund_open: '900.00', refund_committed: 0 }), { due_raised: 250.5, refunded: 50 })).toBe(200.5);
    });

    it('is floored at 0 and rounded to two decimals', () => {
        expect(refundCap(paid({ refund_open: '100.00', refund_committed: '1300.00' }))).toBe(0);
        expect(refundCap(paid({ refund_open: '0' }))).toBe(0);
        expect(refundCap(paid({ refund_open: '10.005', refund_committed: 0 }))).toBe(10.01);
        expect(refundCap(paid({ refund_open: '900' }), { due_raised: 100, refunded: 100 })).toBe(0);
    });

    it('states the cap with the formatted amount, for an order or a return', () => {
        expect(refundCapText(120, false, t)).toBe(`orders.refund.cap|${formatMoney(120, 'INR')}`);
        expect(refundCapText(75.5, true, t)).toBe(`orders.refund.capReturn|${formatMoney(75.5, 'INR')}`);
    });

    it('an amount above the cap is a field error', () => {
        expect(amountProblem(120.01, 120)).toBe('aboveCap');
        expect(amountProblem(120, 120)).toBeNull();
        expect(amountProblem(0, 120)).toBe('positive');
        expect(amountProblem(null, 120)).toBe('required');
    });

    it('the server 409 carries the amount and maps to the same sentence', () => {
        const error = readOrderError(
            new AxiosError('x', 'ERR', undefined, undefined, {
                status: 409,
                data: { message: 'REFUND_ABOVE_DUE: 120.00 is due back to the customer' },
                headers: {},
                statusText: '',
                config: {} as never,
            } as never)
        );
        expect(error.amount).toBe('120.00');
        expect(error.key).toBe('orders.errors.REFUND_ABOVE_DUE');
    });
});

describe('receiptDue', () => {
    it('is the server amount_due: a ₹1,000 credit order with ₹300 returned before payment owes ₹700', () => {
        // F1 (CommerceOrderReturnsViewDueTest): the detail sends amount_due net of the return.
        const detail = detailFixture({ amount_due: '700.00' }, { total: '1000.00', amount_paid: 0, payment_status: 'UNPAID' });
        expect(detail.amount_due).toBe(700);
        expect(receiptDue(detail)).toBe(700);
        expect(receiptDue(detailFixture({ amount_due: 0 }, { total: '1000.00', amount_paid: 0 }))).toBe(0);
        expect(receiptDue(detailFixture({ amount_due: '-5.00' }, { total: '1000.00' }))).toBe(0);
    });

    it('falls back to total less paid only when the server sent no amount_due, floored at 0', () => {
        expect(receiptDue(detailFixture({}, { total: '800.00', amount_paid: '300.00' }))).toBe(500);
        expect(receiptDue(detailFixture({}, { total: '800.00', amount_paid: '900.00' }))).toBe(0);
    });
});
