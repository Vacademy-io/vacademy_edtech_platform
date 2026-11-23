/** F4: the refund cap and its sentence, and what a receipt may take. */
import { AxiosError } from 'axios';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '@/components/design-system/money-cell';
import { detailFixture } from './order-fixtures';
import { readOrderError } from './order-errors';
import { normalizeRow } from './order-api';
import { rowDue } from './order-format';
import {
    amountProblem,
    creditSplit,
    dueLoweredByReturns,
    owesOnCredit,
    previewSplit,
    receiptDue,
    refundCap,
    refundCapText,
} from './refund-cap';

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

/** A staff credit order of ₹1,000 (contract §15 cases). */
const credit = (money: Record<string, unknown>, order: Record<string, unknown> = {}) =>
    detailFixture(money, {
        channel: 'ADMIN',
        status: 'DELIVERED',
        payment_method: 'CREDIT',
        payment_status: 'UNPAID',
        total: '1000.00',
        amount_paid: 0,
        ...order,
    });

describe('returns before payment (contract §15)', () => {
    it('a staff credit order that still owes takes a return; website, COD and paid orders keep their rules', () => {
        expect(owesOnCredit(credit({ amount_due: '1000.00' }))).toBe(true);
        expect(owesOnCredit(credit({ amount_due: '600.00' }, { payment_status: 'PARTIALLY_PAID', amount_paid: '400.00' }))).toBe(true);
        expect(owesOnCredit(credit({ amount_due: 0 }, { payment_status: 'PAID', amount_paid: '1000.00' }))).toBe(false);
        expect(owesOnCredit(credit({ amount_due: 0 }))).toBe(false);
        expect(owesOnCredit(credit({ amount_due: '1000.00' }, { channel: 'ONLINE' }))).toBe(false);
        expect(owesOnCredit(credit({ amount_due: '1000.00' }, { payment_method: 'COD' }))).toBe(false);
        expect(owesOnCredit(credit({ amount_due: '1000.00' }, { channel: 'POS' }))).toBe(false);
    });

    it('₹300 returned before payment took ₹300 off; ₹400 paid then ₹700 returned took ₹600 off', () => {
        expect(dueLoweredByReturns(credit({ amount_due: '700.00' }))).toBe(300);
        expect(dueLoweredByReturns(credit({ amount_due: 0 }, { payment_status: 'PARTIALLY_PAID', amount_paid: '400.00' }))).toBe(600);
        expect(dueLoweredByReturns(credit({ amount_due: '1000.00' }))).toBe(0);
        // No amount_due from the server: nothing is claimed.
        expect(dueLoweredByReturns(credit({}))).toBe(0);
    });

    it('a return\'s credit goes first off what is owed, the rest is paid back', () => {
        expect(creditSplit(300, 1000)).toEqual({ offDue: 300, paidBack: 0 });
        expect(creditSplit(700, 600)).toEqual({ offDue: 600, paidBack: 100 });
        expect(creditSplit(1000, 1000)).toEqual({ offDue: 1000, paidBack: 0 });
        expect(creditSplit(250.5, 0)).toEqual({ offDue: 0, paidBack: 250.5 });
    });
});

describe('the return preview split: the server\'s credit_to_due / refund_amount first', () => {
    it('uses the server split when sent, even where the screen\'s own estimate would differ', () => {
        // ₹700 back on an order with ₹600 owed and only ₹50 received: the server caps the refund at what was paid.
        expect(previewSplit({ credit_estimate: 700, credit_to_due: 600, refund_amount: 50 }, true, 600)).toEqual({
            offDue: 600,
            paidBack: 50,
        });
    });

    it('falls back to the screen estimate when the server sent no split, and only on an order that owes', () => {
        expect(previewSplit({ credit_estimate: 700, credit_to_due: null, refund_amount: null }, true, 600)).toEqual({
            offDue: 600,
            paidBack: 100,
        });
        expect(previewSplit({ credit_estimate: 300 }, true, 1000)).toEqual({ offDue: 300, paidBack: 0 });
        expect(previewSplit({ credit_estimate: 300, credit_to_due: null, refund_amount: null }, false, 0)).toBeNull();
        expect(previewSplit({ credit_estimate: null, credit_to_due: null, refund_amount: null }, true, 600)).toBeNull();
        expect(previewSplit(null, true, 600)).toBeNull();
    });

    it('an order that owes nothing shows no split when the server put nothing off a due', () => {
        expect(previewSplit({ credit_estimate: 300, credit_to_due: 0, refund_amount: 300 }, false, 0)).toBeNull();
        expect(previewSplit({ credit_estimate: 300, credit_to_due: 200, refund_amount: 100 }, false, 0)).toEqual({
            offDue: 200,
            paidBack: 100,
        });
    });
});

describe('M10: the DUES queue reads amount_due', () => {
    it('a listed order owes the server amount_due (₹700 after ₹300 returned), else total − paid', () => {
        const row = normalizeRow({ id: 'o', total: '1000.00', amount_paid: 0, amount_due: '700.00' });
        expect(row.amount_due).toBe(700);
        expect(rowDue(row)).toBe(700);
        expect(rowDue(normalizeRow({ id: 'o', total: '1000.00', amount_paid: '400.00' }))).toBe(600);
        expect(rowDue(normalizeRow({ id: 'o', total: '1000.00', amount_paid: 0, amount_due: '-1.00' }))).toBe(0);
    });
});
