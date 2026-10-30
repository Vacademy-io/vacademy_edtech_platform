import { describe, expect, it } from 'vitest';
import { normalizeDailyReport, normalizeItemsPage, periodParams } from './engagement-daily-report';

describe('report period params', () => {
    it('sends date for one day, from and to for a range, and nothing for today', () => {
        expect(periodParams({ from: '2026-10-29', to: '2026-10-29' })).toEqual({
            date: '2026-10-29',
        });
        expect(periodParams({ from: '2026-10-23', to: '2026-10-29' })).toEqual({
            from: '2026-10-23',
            to: '2026-10-29',
        });
        expect(periodParams(null)).toEqual({});
        expect(periodParams({ from: '', to: '' })).toEqual({});
    });
});

describe('a report response', () => {
    it('reads the period of a range response', () => {
        const report = normalizeDailyReport({
            date: '2026-10-29',
            from: '2026-10-23',
            to: '2026-10-29',
            days: 7,
            previous: {
                from: '2026-10-16',
                to: '2026-10-22',
                leadsAdded: 3,
                sent: 20,
                replies: 2,
                demosBooked: 1,
                conversions: 0,
                credits: 12.5,
                statusChanges: 4,
            },
            trend: [
                {
                    date: '2026-10-28',
                    sent: 1,
                    replies: 0,
                    demosBooked: 0,
                    credits: 0,
                    statusChanges: 0,
                },
            ],
        });
        expect([report.from, report.to, report.days, report.date]).toEqual([
            '2026-10-23',
            '2026-10-29',
            7,
            '2026-10-29',
        ]);
        expect(report.previous).toMatchObject({ credits: 12.5, sent: 20, from: '2026-10-16' });
        expect(report.trend).toHaveLength(1);
    });

    it('still parses a response from a server that knows only one day', () => {
        const report = normalizeDailyReport({ date: '2026-10-29', timezone: 'Asia/Dubai' });
        expect([report.from, report.to, report.days, report.date]).toEqual([
            '2026-10-29',
            '2026-10-29',
            1,
            '2026-10-29',
        ]);
        expect(report.previous).toBeNull();
    });

    it('keeps parsing when the cost block still carries token counts, or none', () => {
        const withAi = normalizeDailyReport({
            costs: {
                credits: { messages: 1, calls: 0, leadAgent: 0, total: 1 },
                whatsapp: {
                    amount: 0,
                    currency: 'INR',
                    billableMessages: 0,
                    estimatedMessages: 0,
                    missingRate: 0,
                },
                ai: { tokensIn: 5, tokensOut: 6, decisionsWithUsage: 1, trackedSince: null },
            },
        });
        expect(withAi.costs?.credits.total).toBe(1);
        const without = normalizeDailyReport({
            costs: {
                credits: { messages: 1, calls: 0, leadAgent: 0, total: 1 },
                whatsapp: {
                    amount: 0,
                    currency: 'INR',
                    billableMessages: 0,
                    estimatedMessages: 0,
                    missingRate: 0,
                },
            },
        });
        expect(without.costs?.ai).toBeUndefined();
    });

    it('keeps a figure of the previous period the server could not read unknown, never 0', () => {
        const report = normalizeDailyReport({
            date: '2026-10-29',
            previous: { from: '2026-10-28', to: '2026-10-28', sent: 5, replies: null } as never,
        });
        expect(report.previous).toMatchObject({ sent: 5, replies: null, credits: null });
    });
});

describe('an items response', () => {
    const params = {
        kind: 'LEADS_ADDED' as const,
        from: '2026-10-23',
        to: '2026-10-29',
        page: 0,
        size: 50,
    };

    it('reads from and to, and falls back to the asked period for an older server', () => {
        const range = normalizeItemsPage(
            { from: '2026-10-23', to: '2026-10-29', date: '2026-10-29', total: 4, rows: [] },
            params
        );
        expect([range.from, range.to, range.date, range.total]).toEqual([
            '2026-10-23',
            '2026-10-29',
            '2026-10-29',
            4,
        ]);
        const old = normalizeItemsPage({ date: '2026-10-29' }, params);
        expect([old.from, old.to]).toEqual(['2026-10-29', '2026-10-29']);
        const empty = normalizeItemsPage(null, params);
        expect([empty.from, empty.to, empty.date]).toEqual([
            '2026-10-23',
            '2026-10-29',
            '2026-10-29',
        ]);
    });
});
