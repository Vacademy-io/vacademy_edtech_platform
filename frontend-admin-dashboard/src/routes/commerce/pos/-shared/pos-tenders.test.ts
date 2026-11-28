/** Contract §7.5: tender maths in paise. */
import { describe, expect, it } from 'vitest';
import {
    type TenderRow,
    canPay,
    change,
    creditApplied,
    remaining,
    tenderProblem,
    toPaise,
    toTenderRequest,
} from './pos-tenders';

const row = (mode: TenderRow['mode'], amount: string, extra: Partial<TenderRow> = {}): TenderRow => ({
    key: `${mode}-${amount}`,
    mode,
    amount,
    reference: '',
    cashTendered: '',
    ...extra,
});

describe('pos tenders', () => {
    it('works in paise: 0.10 + 0.20 pays 0.30 exactly', () => {
        expect(0.1 + 0.2).not.toBe(0.3);
        const rows = [row('CASH', '0.10'), row('UPI', '0.20', { reference: 'R1' })];
        expect(remaining(0.3, 0, rows)).toBe(0);
        expect(canPay(0.3, 0, rows)).toBe(true);
        expect(toPaise('1,234.50')).toBe(123450);
        expect(Number.isNaN(toPaise('12.345'))).toBe(true);
    });

    it('remaining after a split; over-payment is negative', () => {
        expect(remaining(2050, 0, [row('CASH', '1000.00')])).toBe(1050);
        expect(remaining(2050, 0, [row('CASH', '1000'), row('UPI', '1050', { reference: 'U1' })])).toBe(0);
        expect(remaining(100, 0, [row('CASH', '150')])).toBe(-50);
    });

    it('change = cash received − cash amount, never below 0; empty means exact', () => {
        expect(change([row('CASH', '450', { cashTendered: '500' })])).toBe(50);
        expect(change([row('CASH', '450', { cashTendered: '' })])).toBe(0);
        expect(change([row('UPI', '450', { reference: 'U' })])).toBe(0);
    });

    it('canPay needs remaining 0, a reference on UPI/CARD and enough cash received', () => {
        expect(tenderProblem(900, 0, [row('UPI', '900')])).toBe('reference');
        expect(tenderProblem(900, 0, [row('CARD', '900', { reference: 'slip 12' })])).toBeNull();
        expect(tenderProblem(900, 0, [row('CASH', '900', { cashTendered: '800' })])).toBe('cashShort');
        expect(tenderProblem(900, 0, [row('CASH', '500'), row('CASH', '400')])).toBe('twoCash');
        expect(tenderProblem(900, 0, [row('CASH', '800')])).toBe('short');
        expect(tenderProblem(900, 0, [row('CASH', '1000')])).toBe('over');
        expect(tenderProblem(900, 0, [row('CASH', '0')])).toBe('amount');
        expect(tenderProblem(900, 0, [row('BANK_TRANSFER', '900')])).toBeNull();
    });

    it('an exchange credit counts first, never more than the total', () => {
        expect(creditApplied(900, 300)).toBe(300);
        expect(creditApplied(900, 1200)).toBe(900);
        expect(remaining(900, 300, [])).toBe(600);
        expect(canPay(900, 300, [row('CASH', '600')])).toBe(true);
        expect(canPay(900, 1200, [])).toBe(true);
    });

    it('toTenderRequest sends 2-decimal strings, reference and cash received only when given', () => {
        expect(
            toTenderRequest([row('CASH', '1000', { cashTendered: '2000' }), row('UPI', '1050.5', { reference: ' UPI ref 4411 ' })])
        ).toEqual([
            { mode: 'CASH', amount: '1000.00', cash_tendered: '2000.00' },
            { mode: 'UPI', amount: '1050.50', reference: 'UPI ref 4411' },
        ]);
    });
});
