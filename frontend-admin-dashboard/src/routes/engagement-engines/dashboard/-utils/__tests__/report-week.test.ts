import { describe, expect, it } from 'vitest';
import { windowStart } from '../report-period';
import {
    canShiftWeek,
    clampWeekEnd,
    earliestWeekEnd,
    shiftWeek,
    weekEndingOn,
} from '../report-week';

const TODAY = '2026-11-04';
const MIN = windowStart(TODAY);

describe('the week', () => {
    it('is the 7 days ending on a day, both included', () => {
        expect(weekEndingOn('2026-11-04')).toEqual({ from: '2026-10-29', to: '2026-11-04' });
        expect(weekEndingOn('2026-03-02')).toEqual({ from: '2026-02-24', to: '2026-03-02' });
        expect(weekEndingOn('2027-01-03')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    });

    it('cannot start before the first day of the 90-day window', () => {
        expect(MIN).toBe('2026-08-07');
        expect(earliestWeekEnd(MIN)).toBe('2026-08-13');
        expect(weekEndingOn(earliestWeekEnd(MIN)).from).toBe(MIN);
    });
});

describe('moving between weeks', () => {
    it('moves a whole week back and forward', () => {
        expect(shiftWeek('2026-11-04', -1, MIN, TODAY)).toBe('2026-10-28');
        expect(shiftWeek('2026-10-28', 1, MIN, TODAY)).toBe('2026-11-04');
    });

    it('never goes into the future', () => {
        expect(shiftWeek(TODAY, 1, MIN, TODAY)).toBe(TODAY);
        // A week that ends 3 days ago moves to today, not past it.
        expect(shiftWeek('2026-11-01', 1, MIN, TODAY)).toBe(TODAY);
        expect(canShiftWeek(TODAY, 1, MIN, TODAY)).toBe(false);
        expect(canShiftWeek('2026-11-03', 1, MIN, TODAY)).toBe(true);
    });

    it('stops at the start of the window', () => {
        const earliest = earliestWeekEnd(MIN);
        expect(shiftWeek(earliest, -1, MIN, TODAY)).toBe(earliest);
        expect(shiftWeek('2026-08-16', -1, MIN, TODAY)).toBe(earliest);
        expect(canShiftWeek(earliest, -1, MIN, TODAY)).toBe(false);
        expect(canShiftWeek('2026-08-14', -1, MIN, TODAY)).toBe(true);
    });

    it('can walk all the way back and forward again without leaving the window', () => {
        let end = TODAY;
        let steps = 0;
        while (canShiftWeek(end, -1, MIN, TODAY)) {
            end = shiftWeek(end, -1, MIN, TODAY);
            expect(weekEndingOn(end).from >= MIN).toBe(true);
            steps++;
        }
        expect(steps).toBeGreaterThan(10);
        while (canShiftWeek(end, 1, MIN, TODAY)) end = shiftWeek(end, 1, MIN, TODAY);
        expect(end).toBe(TODAY);
    });

    it('keeps a picked day inside the allowed days', () => {
        expect(clampWeekEnd('2026-12-01', MIN, TODAY)).toBe(TODAY);
        expect(clampWeekEnd('2026-01-01', MIN, TODAY)).toBe(earliestWeekEnd(MIN));
        expect(clampWeekEnd('2026-10-15', MIN, TODAY)).toBe('2026-10-15');
    });
});
