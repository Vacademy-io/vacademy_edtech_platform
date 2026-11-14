import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportFileName, minDateIso, todayIso } from '../report-format';
import {
    canShift,
    clampPeriod,
    formatPeriodDates,
    normalizePeriodSearch,
    periodDays,
    periodFileTag,
    periodLabel,
    periodOfSearch,
    periodPatch,
    presetOf,
    presetPeriod,
    previousPeriod,
    searchOfPeriod,
    shiftPeriod,
    windowStart,
} from '../report-period';

const TODAY = '2026-10-30';
const MIN = windowStart(TODAY);

describe('the period in the URL', () => {
    it('keeps a day as ?date and a range as ?from&to, and drops the date of a range', () => {
        expect(normalizePeriodSearch({ date: '2026-10-29' })).toEqual({ date: '2026-10-29' });
        expect(normalizePeriodSearch({ from: '2026-10-23', to: '2026-10-29' })).toEqual({
            from: '2026-10-23',
            to: '2026-10-29',
        });
        // from + to win over date, as on the server.
        expect(
            normalizePeriodSearch({ date: '2026-10-01', from: '2026-10-23', to: '2026-10-29' })
        ).toEqual({ from: '2026-10-23', to: '2026-10-29' });
    });

    it('turns a reversed range around and a one-day range into that day', () => {
        expect(normalizePeriodSearch({ from: '2026-10-29', to: '2026-10-23' })).toEqual({
            from: '2026-10-23',
            to: '2026-10-29',
        });
        expect(normalizePeriodSearch({ from: '2026-10-29', to: '2026-10-29' })).toEqual({
            date: '2026-10-29',
        });
    });

    it('ignores a lone end, a malformed day and anything that is not text', () => {
        expect(normalizePeriodSearch({ from: '2026-10-23' })).toEqual({});
        expect(normalizePeriodSearch({ to: '2026-10-23' })).toEqual({});
        expect(normalizePeriodSearch({ from: '2026-10-23', date: '2026-10-29' })).toEqual({
            date: '2026-10-29',
        });
        expect(normalizePeriodSearch({ date: '29/10/2026' })).toEqual({});
        expect(normalizePeriodSearch({ from: 20261023, to: 20261029 })).toEqual({});
        expect(normalizePeriodSearch({})).toEqual({});
    });

    it('reads a period back from the params, and writes one', () => {
        expect(periodOfSearch({})).toBeNull();
        expect(periodOfSearch({ date: '2026-10-29' })).toEqual({
            from: '2026-10-29',
            to: '2026-10-29',
        });
        expect(periodOfSearch({ from: '2026-10-23', to: '2026-10-29' })).toEqual({
            from: '2026-10-23',
            to: '2026-10-29',
        });
        expect(searchOfPeriod({ from: '2026-10-23', to: '2026-10-29' })).toEqual({
            from: '2026-10-23',
            to: '2026-10-29',
        });
        expect(searchOfPeriod({ from: '2026-10-29', to: '2026-10-29' })).toEqual({
            date: '2026-10-29',
        });
    });

    it('leaves today out of the report URL when asked to, but never a range ending today', () => {
        expect(searchOfPeriod({ from: TODAY, to: TODAY }, TODAY)).toEqual({});
        expect(searchOfPeriod({ from: '2026-10-24', to: TODAY }, TODAY)).toEqual({
            from: '2026-10-24',
            to: TODAY,
        });
    });

    it('overwrites the old period when merged into a search', () => {
        const patch = periodPatch({ from: '2026-10-23', to: '2026-10-29' });
        expect(patch).toEqual({ date: undefined, from: '2026-10-23', to: '2026-10-29' });
        const before: Record<string, string | undefined> = { date: '2026-10-01', tab: 'demos' };
        const merged = { ...before, ...patch };
        expect(merged.date).toBeUndefined();
        expect(merged).toMatchObject({ tab: 'demos', from: '2026-10-23', to: '2026-10-29' });
        expect(periodPatch({ from: '2026-10-29', to: '2026-10-29' })).toEqual({
            date: '2026-10-29',
            from: undefined,
            to: undefined,
        });
    });
});

describe('period arithmetic', () => {
    it('counts both ends, across months and daylight-saving changes', () => {
        expect(periodDays({ from: '2026-10-29', to: '2026-10-29' })).toBe(1);
        expect(periodDays({ from: '2026-10-23', to: '2026-10-29' })).toBe(7);
        expect(periodDays({ from: '2026-09-28', to: '2026-10-04' })).toBe(7);
        expect(periodDays({ from: '2026-03-27', to: '2026-03-30' })).toBe(4);
        expect(periodDays({ from: '2026-08-02', to: '2026-10-30' })).toBe(90);
    });

    it('has a 90-day window ending today', () => {
        expect(MIN).toBe('2026-08-02');
        expect(periodDays({ from: MIN, to: TODAY })).toBe(90);
        // The page's own window is the same 90 days.
        expect(periodDays({ from: minDateIso('UTC'), to: todayIso('UTC') })).toBe(90);
    });

    it('moves a day by a day and a range by its own length', () => {
        expect(shiftPeriod({ from: '2026-10-29', to: '2026-10-29' }, -1, MIN, TODAY)).toEqual({
            from: '2026-10-28',
            to: '2026-10-28',
        });
        const week = { from: '2026-10-16', to: '2026-10-22' };
        expect(shiftPeriod(week, -1, MIN, TODAY)).toEqual({ from: '2026-10-09', to: '2026-10-15' });
        expect(shiftPeriod(week, 1, MIN, TODAY)).toEqual({ from: '2026-10-23', to: '2026-10-29' });
        expect(previousPeriod(week)).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    });

    it('stops at the edge of the window and keeps its length', () => {
        // Forward past today: the last 7 days ending today.
        expect(shiftPeriod({ from: '2026-10-21', to: '2026-10-27' }, 1, MIN, TODAY)).toEqual({
            from: '2026-10-24',
            to: TODAY,
        });
        // Back past the first day: the first 7 days of the window.
        expect(shiftPeriod({ from: '2026-08-05', to: '2026-08-11' }, -1, MIN, TODAY)).toEqual({
            from: MIN,
            to: '2026-08-08',
        });
        // Already at the edge: nowhere to go.
        expect(shiftPeriod({ from: TODAY, to: TODAY }, 1, MIN, TODAY)).toEqual({
            from: TODAY,
            to: TODAY,
        });
    });

    it('disables an arrow only at its edge', () => {
        expect(canShift({ from: '2026-10-24', to: TODAY }, 1, MIN, TODAY)).toBe(false);
        expect(canShift({ from: '2026-10-24', to: TODAY }, -1, MIN, TODAY)).toBe(true);
        expect(canShift({ from: MIN, to: '2026-08-08' }, -1, MIN, TODAY)).toBe(false);
        expect(canShift({ from: MIN, to: '2026-08-08' }, 1, MIN, TODAY)).toBe(true);
    });

    it('clamps a period into the window, even one wholly outside it', () => {
        expect(clampPeriod({ from: '2026-07-01', to: '2026-08-10' }, MIN, TODAY)).toEqual({
            from: MIN,
            to: '2026-08-10',
        });
        expect(clampPeriod({ from: '2026-10-20', to: '2026-11-05' }, MIN, TODAY)).toEqual({
            from: '2026-10-20',
            to: TODAY,
        });
        expect(clampPeriod({ from: '2026-01-01', to: '2026-01-05' }, MIN, TODAY)).toEqual({
            from: MIN,
            to: MIN,
        });
        expect(clampPeriod({ from: '2026-12-01', to: '2026-12-05' }, MIN, TODAY)).toEqual({
            from: TODAY,
            to: TODAY,
        });
    });
});

describe('presets', () => {
    it('are concrete days that end today', () => {
        expect(presetPeriod('today', TODAY)).toEqual({ from: TODAY, to: TODAY });
        expect(presetPeriod('yesterday', TODAY)).toEqual({ from: '2026-10-29', to: '2026-10-29' });
        expect(presetPeriod('last7', TODAY)).toEqual({ from: '2026-10-24', to: TODAY });
        expect(presetPeriod('last30', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
        expect(presetPeriod('last90', TODAY)).toEqual({ from: MIN, to: TODAY });
    });

    it('are recognised again from their days', () => {
        expect(presetOf({ from: '2026-10-24', to: TODAY }, TODAY)).toBe('last7');
        expect(presetOf({ from: '2026-10-29', to: '2026-10-29' }, TODAY)).toBe('yesterday');
        expect(presetOf({ from: MIN, to: TODAY }, TODAY)).toBe('last90');
        // The same length ending yesterday is a custom range.
        expect(presetOf({ from: '2026-10-23', to: '2026-10-29' }, TODAY)).toBeNull();
        expect(presetOf({ from: '2026-10-28', to: '2026-10-28' }, TODAY)).toBeNull();
    });
});

describe('period words', () => {
    let t: TFunction;
    beforeAll(async () => {
        const file = path.resolve(
            __dirname,
            '../../../../../../public/locales/en/engagementDailyReport.json'
        );
        await i18next.init({
            lng: 'en',
            resources: { en: { report: JSON.parse(readFileSync(file, 'utf8')) } },
            ns: ['report'],
            defaultNS: 'report',
        });
        t = i18next.t.bind(i18next) as unknown as TFunction;
    });

    it('formats the days of a period', () => {
        expect(formatPeriodDates({ from: '2026-10-29', to: '2026-10-29' })).toBe('29 Oct 2026');
        expect(formatPeriodDates({ from: '2026-10-12', to: '2026-10-29' })).toBe(
            '12 Oct – 29 Oct 2026'
        );
        expect(formatPeriodDates({ from: '2026-12-28', to: '2027-01-03' })).toBe(
            '28 Dec 2026 – 3 Jan 2027'
        );
        expect(formatPeriodDates({ from: '2026-10-23', to: '2026-10-29' }, 'compact')).toBe(
            '23–29 Oct'
        );
        expect(formatPeriodDates({ from: '2026-09-28', to: '2026-10-04' }, 'compact')).toBe(
            '28 Sep – 4 Oct'
        );
        expect(formatPeriodDates({ from: '2026-12-28', to: '2027-01-03' }, 'compact')).toBe(
            '28 Dec 2026 – 3 Jan 2027'
        );
        expect(formatPeriodDates({ from: '2026-10-29', to: '2026-10-29' }, 'compact')).toBe(
            '29 Oct'
        );
    });

    it('labels the button with the day, the range, or the preset and its days', () => {
        expect(periodLabel({ from: '2026-10-29', to: '2026-10-29' }, TODAY, t)).toBe('29 Oct 2026');
        expect(periodLabel({ from: '2026-10-12', to: '2026-10-29' }, TODAY, t)).toBe(
            '12 Oct – 29 Oct 2026'
        );
        expect(periodLabel({ from: '2026-10-24', to: TODAY }, TODAY, t)).toBe(
            'Last 7 days · 24–30 Oct'
        );
        expect(periodLabel({ from: '2026-10-01', to: TODAY }, TODAY, t)).toBe(
            'Last 30 days · 1–30 Oct'
        );
        expect(periodLabel({ from: MIN, to: TODAY }, TODAY, t)).toBe(
            'Last 90 days · 2 Aug – 30 Oct'
        );
        // Today and Yesterday are single days: the date says it.
        expect(periodLabel({ from: TODAY, to: TODAY }, TODAY, t)).toBe('30 Oct 2026');
    });

    it('names the arrows by the length they move', () => {
        expect(t('period.previous', { count: 1 })).toBe('Previous day');
        expect(t('period.previous', { count: 7 })).toBe('Previous 7 days');
        expect(t('period.next', { count: 30 })).toBe('Next 30 days');
        expect(t('period.preset.last', { count: 90 })).toBe('Last 90 days');
    });

    it('names files after the engine and the period', () => {
        expect(periodFileTag({ from: '2026-10-29', to: '2026-10-29' })).toBe('2026-10-29');
        expect(periodFileTag({ from: '2026-10-12', to: '2026-10-29' })).toBe(
            '2026-10-12_to_2026-10-29'
        );
        // A plain day string is still accepted.
        expect(exportFileName('Spring Push!', '2026-10-30', 'xlsx', 'e1')).toBe(
            'engagement-report-spring-push-2026-10-30.xlsx'
        );
        expect(
            exportFileName('Spring Push!', { from: '2026-10-12', to: '2026-10-29' }, 'pdf', 'e1')
        ).toBe('engagement-report-spring-push-2026-10-12_to_2026-10-29.pdf');
        expect(
            exportFileName('All engines', { from: '2026-10-29', to: '2026-10-29' }, 'xlsx', null)
        ).toBe('engagement-report-all-engines-2026-10-29.xlsx');
    });
});
