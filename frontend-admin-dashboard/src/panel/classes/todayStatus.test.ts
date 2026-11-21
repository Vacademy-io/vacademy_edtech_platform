import { describe, expect, it } from 'vitest';
import { classStatus, zoneOffsetOf, zonedDay, zonedTime } from './todayStatus';
import { MIN, T0, makeClass } from './testRows';

describe('classStatus runs on the time it is given', () => {
    const item = makeClass();

    it('counts down, rounding up to whole minutes', () => {
        expect(classStatus(item, T0 - 5 * MIN)).toEqual({ kind: 'soon', minutes: 5 });
        expect(classStatus(item, T0 - 4.5 * MIN)).toEqual({ kind: 'soon', minutes: 5 });
    });

    it('says nothing further than an hour out', () => {
        expect(classStatus(item, T0 - 61 * MIN)).toEqual({ kind: 'later' });
    });

    it('is Now from the start up to the end', () => {
        expect(classStatus(item, T0)).toEqual({ kind: 'now' });
        expect(classStatus(item, T0 + 44 * MIN)).toEqual({ kind: 'now' });
    });

    it('is Done at the end', () => {
        expect(classStatus(item, T0 + 45 * MIN)).toEqual({ kind: 'done' });
    });

    it('a null end time never reads as Done', () => {
        const open = makeClass({ ends_at_ms: null });
        expect(classStatus(open, T0 + 600 * MIN)).toEqual({ kind: 'now' });
    });
});

describe('zone helpers need no Intl data', () => {
    it('work out the offset from the row', () => {
        expect(zoneOffsetOf(makeClass())).toBe(5.5 * 60 * MIN);
    });

    it('handle a zone behind UTC', () => {
        const ny = makeClass({
            meeting_date: '2026-11-03',
            time_label: '23:30',
            starts_at_ms: Date.UTC(2026, 10, 4, 4, 30),
        });
        expect(zoneOffsetOf(ny)).toBe(-5 * 60 * MIN);
    });

    it('fall back when a row makes no sense', () => {
        expect(zoneOffsetOf(makeClass({ meeting_date: 'nope' }))).toBe(5.5 * 60 * MIN);
        expect(zoneOffsetOf(makeClass({ starts_at_ms: 0 }))).toBe(5.5 * 60 * MIN);
        expect(zoneOffsetOf(undefined)).toBe(5.5 * 60 * MIN);
    });

    it('format day and time at the midnight boundary', () => {
        const offset = 5.5 * 60 * MIN;
        const lastMinute = Date.UTC(2026, 10, 4, 18, 29);
        expect(zonedDay(lastMinute, offset)).toBe('2026-11-04');
        expect(zonedTime(lastMinute, offset)).toBe('23:59');
        expect(zonedDay(lastMinute + MIN, offset)).toBe('2026-11-05');
        expect(zonedTime(lastMinute + MIN, offset)).toBe('00:00');
    });
});
