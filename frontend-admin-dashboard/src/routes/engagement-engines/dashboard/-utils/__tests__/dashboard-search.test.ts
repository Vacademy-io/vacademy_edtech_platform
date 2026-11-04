import { describe, expect, it } from 'vitest';
import {
    isNumbersOpen,
    normalizeDashboardSearch,
    numbersPatch,
    viewOfSearch,
    viewPatch,
} from '../dashboard-search';

describe('?view', () => {
    it('keeps weekly and overview, and drops anything else', () => {
        expect(normalizeDashboardSearch({ view: 'weekly' }).view).toBe('weekly');
        expect(normalizeDashboardSearch({ view: 'overview' }).view).toBe('overview');
        expect(normalizeDashboardSearch({ view: 'daily' }).view).toBeUndefined();
        expect(normalizeDashboardSearch({ view: 'monthly' }).view).toBeUndefined();
        expect(normalizeDashboardSearch({ view: 7 }).view).toBeUndefined();
        expect(normalizeDashboardSearch({}).view).toBeUndefined();
    });

    it('reads the view of a search, daily by default', () => {
        expect(viewOfSearch({})).toBe('daily');
        expect(viewOfSearch({ view: 'weekly' })).toBe('weekly');
        expect(viewOfSearch({ view: 'overview' })).toBe('overview');
        expect(viewOfSearch({ view: 'whatever' })).toBe('daily');
    });

    it('leaves the daily report out of the URL', () => {
        expect(viewPatch('daily')).toEqual({ view: undefined });
        expect(viewPatch('weekly')).toEqual({ view: 'weekly' });
        expect(viewPatch('overview')).toEqual({ view: 'overview' });
    });
});

describe('?numbers', () => {
    it('is open for 1, however the router hands it over', () => {
        expect(normalizeDashboardSearch({ numbers: 1 }).numbers).toBe(1);
        expect(normalizeDashboardSearch({ numbers: '1' }).numbers).toBe(1);
        expect(normalizeDashboardSearch({ numbers: true }).numbers).toBe(1);
        expect(normalizeDashboardSearch({ numbers: 'true' }).numbers).toBe(1);
    });

    it('is closed for everything else', () => {
        for (const value of [0, '0', false, 'false', '', 2, 'yes', null, undefined]) {
            expect(
                normalizeDashboardSearch({ numbers: value }).numbers,
                String(value)
            ).toBeUndefined();
        }
        expect(normalizeDashboardSearch({}).numbers).toBeUndefined();
    });

    it('is written as 1 when open and left out when closed', () => {
        expect(numbersPatch(true)).toEqual({ numbers: 1 });
        expect(numbersPatch(false)).toEqual({ numbers: undefined });
        expect(isNumbersOpen({ numbers: 1 })).toBe(true);
        expect(isNumbersOpen({})).toBe(false);
    });
});

describe('the rest of the URL still works with them', () => {
    it('keeps the engine and the period beside the view and numbers', () => {
        expect(
            normalizeDashboardSearch({
                view: 'weekly',
                numbers: 1,
                engine: 'eng-1',
                date: '2026-11-04',
            })
        ).toEqual({ view: 'weekly', numbers: 1, engine: 'eng-1', date: '2026-11-04' });
    });

    it('keeps a range, as before, and drops a bad day', () => {
        expect(normalizeDashboardSearch({ from: '2026-10-28', to: '2026-11-03' })).toMatchObject({
            from: '2026-10-28',
            to: '2026-11-03',
        });
        expect(normalizeDashboardSearch({ date: 'yesterday' }).date).toBeUndefined();
        expect(normalizeDashboardSearch({ engine: '' }).engine).toBeUndefined();
    });

    it('opens an old link, with no view or numbers, as the daily report', () => {
        const search = normalizeDashboardSearch({ engine: 'eng-1', date: '2026-10-30' });
        expect(viewOfSearch(search)).toBe('daily');
        expect(isNumbersOpen(search)).toBe(false);
    });
});
