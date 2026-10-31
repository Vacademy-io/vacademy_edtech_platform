import { describe, expect, it } from 'vitest';
import {
    addMonthsIso,
    equalSplit,
    generateDueDates,
    partsFromFeeTypes,
    discountAmount,
    rebalanceRows,
    setToPay,
    spreadDiscount,
    rowsFromRule,
    validateSchedule,
    type SchedulePart,
} from './installment-schedule';
import type { CPOFeeType } from '@/routes/financial-management/fee-plans/-types/cpo-types';

// These cases mirror InstallmentScheduleServiceTest on the backend: the wizard's preview
// must show exactly the rows the backend writes.

const fee = (total: number, split = true): SchedulePart => ({ feeTypeName: 'Fee', total, split });

describe('installment schedule maths', () => {
    it('splits into whole units with the remainder on installment #1', () => {
        expect(equalSplit(40000, 3)).toEqual([13334, 13333, 13333]);
        expect(equalSplit(1000.5, 2)).toEqual([500.5, 500]);
    });

    it('counts every-N-days from the first due date', () => {
        expect(generateDueDates('2026-10-15', 4, 'DAYS', 30)).toEqual([
            '2026-10-15',
            '2026-11-14',
            '2026-12-14',
            '2027-01-13',
        ]);
    });

    it('keeps the day of month for monthly gaps without drifting', () => {
        expect(generateDueDates('2026-01-31', 4, 'MONTHS', 1)).toEqual([
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
            '2026-04-30',
        ]);
        expect(addMonthsIso('2026-11-30', 3)).toBe('2027-02-28');
    });

    it('sums each split fee per installment', () => {
        const rows = rowsFromRule(
            { count: 3, interval: { unit: 'MONTHS', value: 1 }, first_due_date: '2026-11-01' },
            [fee(30000), fee(6000)]
        );
        expect(rows.map((r) => r.amount)).toEqual([12000, 12000, 12000]);
    });

    it('treats template installments or has_installment as split, others as upfront', () => {
        const feeTypes = [
            {
                name: 'Tuition',
                assigned_fee_value: {
                    amount: 0,
                    has_installment: false,
                    installments: [{ amount: 5000 }, { amount: 5000 }],
                },
            },
            {
                name: 'Admission',
                assigned_fee_value: { amount: 2000, has_installment: false, installments: [] },
            },
            {
                name: 'Course',
                assigned_fee_value: { amount: 9000, has_installment: true, installments: [] },
            },
        ] as unknown as CPOFeeType[];
        expect(partsFromFeeTypes(feeTypes)).toEqual([
            { feeTypeName: 'Tuition', total: 10000, split: true },
            { feeTypeName: 'Admission', total: 2000, split: false },
            { feeTypeName: 'Course', total: 9000, split: true },
        ]);
    });
});

describe('validateSchedule', () => {
    const rule = {
        count: 4,
        interval: { unit: 'DAYS' as const, value: 30 },
        first_due_date: '2026-10-15',
    };

    it('accepts a plain rule', () => {
        expect(validateSchedule(rule, [fee(40000)], 60)).toBeNull();
    });

    it('rejects edited amounts that do not add up to the fee', () => {
        const err = validateSchedule(
            {
                ...rule,
                rows: [
                    { due_date: '2026-10-15', amount: 20000 },
                    { due_date: '2026-11-15', amount: 10000 },
                ],
            },
            [fee(40000)],
            60
        );
        expect(err?.key).toBe('schedule.errors.amountMismatch');
    });

    it('rejects a mix of rows with and without amounts', () => {
        const err = validateSchedule(
            {
                ...rule,
                rows: [
                    { due_date: '2026-10-15', amount: 40000 },
                    { due_date: '2026-11-15', amount: null },
                ],
            },
            [fee(40000)],
            60
        );
        expect(err?.key).toBe('schedule.errors.mixedAmounts');
    });

    it('rejects dates out of order', () => {
        const err = validateSchedule(
            { rows: [{ due_date: '2026-11-15' }, { due_date: '2026-10-15' }] },
            [fee(40000)],
            60
        );
        expect(err?.key).toBe('schedule.errors.datesOutOfOrder');
    });

    it('honours the plan maximum and a plan with nothing to split', () => {
        expect(validateSchedule({ ...rule, count: 7 }, [fee(40000)], 6)?.key).toBe(
            'schedule.errors.countRange'
        );
        expect(validateSchedule(rule, [fee(5000, false)], 60)?.key).toBe(
            'schedule.errors.nothingToSplit'
        );
    });
});

describe('validateSchedule — review follow-ups', () => {
    it('rejects a gap beyond the backend limit', () => {
        expect(
            validateSchedule(
                { count: 3, interval: { unit: 'DAYS', value: 5000 }, first_due_date: '2026-10-15' },
                [fee(30000)],
                60
            )?.key
        ).toBe('schedule.errors.gapRange');
    });

    it('rejects a fee too small for the count', () => {
        expect(
            validateSchedule(
                { count: 3, interval: { unit: 'MONTHS', value: 1 }, first_due_date: '2026-10-15' },
                [fee(2)],
                60
            )?.key
        ).toBe('schedule.errors.tooSmall');
    });

    it('rejects zero rows and more than 2 decimals', () => {
        const base = {
            count: 2,
            interval: { unit: 'MONTHS' as const, value: 1 },
            first_due_date: '2026-10-15',
        };
        expect(
            validateSchedule(
                {
                    ...base,
                    rows: [
                        { due_date: '2026-10-15', amount: 1000 },
                        { due_date: '2026-11-15', amount: 0 },
                    ],
                },
                [fee(1000)],
                60
            )?.key
        ).toBe('schedule.errors.negativeAmount');
        expect(
            validateSchedule(
                {
                    ...base,
                    rows: [
                        { due_date: '2026-10-15', amount: 500.005 },
                        { due_date: '2026-11-15', amount: 499.995 },
                    ],
                },
                [fee(1000)],
                60
            )?.key
        ).toBe('schedule.errors.decimals');
    });
});

describe('rebalanceRows', () => {
    const rows = ['2026-10-14', '2026-11-14', '2026-12-14', '2027-01-14'].map((d) => ({
        due_date: d,
        amount: 5000,
    }));

    it('spreads the rest over the later installments when one is raised', () => {
        expect(rebalanceRows(rows, 0, 10000, 20000).map((r) => r.amount)).toEqual([
            10000, 3334, 3333, 3333,
        ]);
    });

    it('keeps earlier installments and spreads over the later ones', () => {
        expect(rebalanceRows(rows, 1, 2000, 20000).map((r) => r.amount)).toEqual([
            5000, 2000, 6500, 6500,
        ]);
    });

    it('spreads over the earlier installments when the last one is edited', () => {
        expect(rebalanceRows(rows, 3, 8000, 20000).map((r) => r.amount)).toEqual([
            4000, 4000, 4000, 8000,
        ]);
    });

    it('changes only the edited row when it exceeds what is left', () => {
        expect(rebalanceRows(rows, 0, 25000, 20000).map((r) => r.amount)).toEqual([
            25000, 5000, 5000, 5000,
        ]);
    });
});

describe('discount split', () => {
    it('resolves a percentage against the whole price, capped at it', () => {
        expect(discountAmount({ type: 'PERCENTAGE', value: 25 }, 4000)).toBe(1000);
        expect(discountAmount({ type: 'FLAT', value: 5000 }, 4000)).toBe(4000);
        expect(discountAmount(null, 4000)).toBe(0);
    });

    it('takes the same amount off each installment, remainder on the first', () => {
        expect(spreadDiscount([1334, 1333, 1333], 1000, 'EVEN')).toEqual([334, 333, 333]);
    });

    it('gives an installment too small for its share all it has and the rest to the others', () => {
        expect(spreadDiscount([100, 2000, 2000], 900, 'EVEN')).toEqual([100, 400, 400]);
    });

    it('takes it off the first or last installment, spilling over when one is used up', () => {
        expect(spreadDiscount([1334, 1333, 1333], 1000, 'FIRST')).toEqual([1000, 0, 0]);
        expect(spreadDiscount([1334, 1333, 1333], 2000, 'LAST')).toEqual([0, 667, 1333]);
    });

    it('typing what the learner pays keeps each discount and rebalances the rest', () => {
        const rows = [
            { due_date: '2026-10-15', amount: 1334, discount: 334 },
            { due_date: '2026-11-15', amount: 1333, discount: 333 },
            { due_date: '2026-12-15', amount: 1333, discount: 333 },
        ];
        const next = setToPay(rows, 0, 2000, true);
        expect(next.map((r) => r.amount)).toEqual([2334, 833, 833]);
        expect(next.map((r) => (r.amount ?? 0) - (r.discount ?? 0))).toEqual([2000, 500, 500]);
        expect(next.reduce((s, r) => s + (r.amount ?? 0), 0)).toBe(4000);
    });

    it('without rebalancing only the typed installment changes', () => {
        const rows = [
            { due_date: '2026-10-15', amount: 2000, discount: 500 },
            { due_date: '2026-11-15', amount: 2000, discount: 500 },
        ];
        expect(setToPay(rows, 1, 1000, false).map((r) => r.amount)).toEqual([2000, 1500]);
    });
});
