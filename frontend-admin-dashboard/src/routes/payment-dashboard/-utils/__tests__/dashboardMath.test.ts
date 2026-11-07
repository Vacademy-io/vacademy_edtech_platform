import { describe, expect, it } from 'vitest';
import type { DashboardBatchRow, PaymentDashboard } from '@/services/payment-dashboard';
import {
    batchLabel,
    batchParts,
    buildHighlights,
    collectionRate,
    formatCompact,
    heatLevel,
    percentChange,
    resolveDashboardPeriod,
    formatFull,
    toCourseRows,
    toMethodSlices,
    visibleYears,
} from '../dashboardMath';

const batch = (over: Partial<DashboardBatchRow>): DashboardBatchRow => ({
    package_session_id: 'ps',
    package_id: 'p',
    package_name: 'Course',
    level_name: null,
    session_name: null,
    collected: 0,
    collected_all_time: 0,
    overdue: 0,
    still_to_come: 0,
    learners: 0,
    ...over,
});

describe('resolveDashboardPeriod', () => {
    const now = new Date(2026, 8, 28, 15, 0); // 28 Sep 2026

    it('starts the financial year in April', () => {
        expect(resolveDashboardPeriod('fy', now).start).toEqual(new Date(2026, 3, 1));
        expect(resolveDashboardPeriod('fy', new Date(2026, 1, 10)).start).toEqual(
            new Date(2025, 3, 1)
        );
    });

    it('counts the current month in 3 and 12 months', () => {
        expect(resolveDashboardPeriod('3m', now).start).toEqual(new Date(2026, 6, 1));
        expect(resolveDashboardPeriod('12m', now).start).toEqual(new Date(2025, 9, 1));
        expect(resolveDashboardPeriod('this_month', now).start).toEqual(new Date(2026, 8, 1));
    });

    it('leaves all time open at the start', () => {
        expect(resolveDashboardPeriod('all', now).start).toBeUndefined();
    });
});

describe('figures', () => {
    it('formats rupees in lakh and crore', () => {
        expect(formatCompact(1_420_000, 'INR')).toBe('₹14.2L');
        expect(formatCompact(13_000_000, 'INR')).toBe('₹1.3Cr');
        expect(formatCompact(85_000, 'inr')).toBe('₹85K');
        expect(formatCompact(640, null)).toBe('₹640');
    });

    it('has no change to report when the earlier figure is missing or zero', () => {
        expect(percentChange(150, 100)).toBe(50);
        expect(percentChange(100, null)).toBeNull();
        expect(percentChange(100, 0)).toBeNull();
        expect(percentChange(0, 0)).toBe(0);
    });

    it('collection rate is collected over collected plus owed', () => {
        expect(collectionRate(900, 100)).toBe(90);
        expect(collectionRate(0, 0)).toBeNull();
    });

    it('heat levels run 0 (nothing) to 5 (busiest)', () => {
        expect(heatLevel(0, 100)).toBe(0);
        expect(heatLevel(1, 100)).toBe(1);
        expect(heatLevel(100, 100)).toBe(5);
    });
});

describe('toCourseRows', () => {
    it('rolls batches up to their course and puts unlinked money last', () => {
        const rows = toCourseRows([
            batch({
                package_session_id: null,
                package_id: null,
                package_name: null,
                collected: 999,
            }),
            batch({
                package_session_id: 'a1',
                package_id: 'A',
                package_name: 'Alpha',
                collected: 100,
                overdue: 10,
            }),
            batch({
                package_session_id: 'a2',
                package_id: 'A',
                package_name: 'Alpha',
                collected: 50,
                still_to_come: 5,
            }),
            batch({
                package_session_id: 'b1',
                package_id: 'B',
                package_name: 'Beta',
                collected: 300,
            }),
        ]);
        expect(rows.map((r) => r.name)).toEqual(['Beta', 'Alpha', 'Not linked to a course']);
        expect(rows[1]).toMatchObject({ collected: 150, overdue: 10, stillToCome: 5 });
    });
});

describe('toMethodSlices', () => {
    it('treats MANUAL and OFFLINE as one offline method', () => {
        const slices = toMethodSlices([
            { key: 'RAZORPAY', amount: 500, payments: 5, payers: 5 },
            { key: 'MANUAL', amount: 200, payments: 2, payers: 2 },
            { key: 'OFFLINE', amount: 100, payments: 1, payers: 1 },
        ]);
        expect(slices).toEqual([
            { label: 'Razorpay', amount: 500, payments: 5 },
            { label: 'Offline / recorded by admin', amount: 300, payments: 3 },
        ]);
    });
});

describe('buildHighlights', () => {
    const base = (over: Partial<PaymentDashboard>): PaymentDashboard => ({
        period_start: null,
        period_end: '2026-09-28T12:00:00',
        previous_start: null,
        previous_end: null,
        time_zone: 'Asia/Kolkata',
        currency: 'INR',
        kpis: {
            collected: 0,
            previous_collected: null,
            payments: 0,
            previous_payments: null,
            paying_learners: 0,
            previous_paying_learners: null,
            new_paying_learners: 0,
            previous_new_paying_learners: null,
            overdue: 0,
            learners_overdue: 0,
            due_soon: 0,
            learners_due_soon: 0,
            upcoming_days: 30,
            still_to_come: 0,
            learners_still_to_come: 0,
            collected_all_time: 0,
            outstanding: 0,
        },
        months: [],
        years: [],
        days: [],
        sources: [],
        methods: [],
        batches: [],
        ageing: [],
        forecast: [],
        ...over,
    });

    it('says nothing is overdue only when nothing is', () => {
        expect(buildHighlights(base({})).map((h) => h.text)).toEqual([
            'Nothing is overdue right now.',
        ]);
    });

    it('never names a best month when no month collected anything', () => {
        const months = Array.from({ length: 24 }, (_, i) => ({
            bucket: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
            collected: 0,
            payments: 0,
            payers: 0,
            new_payers: 0,
        }));
        expect(buildHighlights(base({ months })).some((h) => h.text.includes('best month'))).toBe(
            false
        );
    });

    it('flags money overdue for more than 90 days', () => {
        const d = base({
            kpis: { ...base({}).kpis, overdue: 50_000, learners_overdue: 3 },
            ageing: [{ bucket: 'D90_PLUS', amount: 20_000, learners: 2, oldest_days: 140 }],
        });
        expect(buildHighlights(d).find((h) => h.tone === 'danger')?.text).toContain(
            '₹20K has been overdue'
        );
    });
});

describe('display polish', () => {
    it('writes rupees in Indian grouping', () => {
        expect(formatFull(427000, 'INR')).toBe('₹4,27,000');
        expect(formatFull(3842000, null)).toBe('₹38,42,000');
    });

    it('never shows the placeholder default level or session', () => {
        expect(batchParts('default', 'DEFAULT')).toBe('');
        expect(batchParts('Class 12', 'DEFAULT')).toBe('Class 12');
        expect(
            batchLabel(
                batch({
                    package_name: 'GP Rating Course',
                    level_name: 'default',
                    session_name: 'DEFAULT',
                })
            )
        ).toBe('GP Rating Course');
        expect(batchLabel(batch({ level_name: 'Class 11', session_name: '2026-27' }))).toBe(
            'Class 11 · 2026-27'
        );
    });

    it('drops financial years before the first payment but keeps two to compare', () => {
        const y = (financial_year: string, collected: number) => ({
            financial_year,
            collected,
            partial: false,
        });
        expect(
            visibleYears([y('23', 0), y('24', 0), y('25', 0), y('26', 5)]).map(
                (x) => x.financial_year
            )
        ).toEqual(['25', '26']);
        expect(
            visibleYears([y('23', 0), y('24', 9), y('25', 0), y('26', 5)]).map(
                (x) => x.financial_year
            )
        ).toEqual(['24', '25', '26']);
        expect(visibleYears([y('23', 1), y('24', 9)]).length).toBe(2);
    });
});
