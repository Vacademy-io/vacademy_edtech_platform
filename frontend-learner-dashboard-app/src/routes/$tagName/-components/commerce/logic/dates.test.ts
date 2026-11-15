import { describe, expect, it } from 'vitest';
import { endOfDate, startOfDate, withinDates } from './dates';

describe('section dates', () => {
    it('reads a bare date as the whole local day', () => {
        expect(new Date(startOfDate('2026-11-20')).getHours()).toBe(0);
        const end = new Date(endOfDate('2026-11-20'));
        expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([20, 23, 59]);
    });

    it('keeps a banner up until the end of its last day', () => {
        const evening = new Date(2026, 10, 20, 21, 30).getTime();
        expect(withinDates(evening, '2026-11-01', '2026-11-20')).toBe(true);
        expect(withinDates(new Date(2026, 10, 21, 0, 1).getTime(), '2026-11-01', '2026-11-20')).toBe(false);
        expect(withinDates(new Date(2026, 9, 31, 23, 0).getTime(), '2026-11-01', '2026-11-20')).toBe(false);
    });

    it('treats a missing or unreadable bound as open, and honours a full timestamp', () => {
        expect(withinDates(Date.now(), '', '')).toBe(true);
        expect(withinDates(Date.now(), 'soon', 'later')).toBe(true);
        expect(withinDates(Date.parse('2026-11-20T10:00:00Z'), '', '2026-11-20T09:00:00Z')).toBe(false);
    });
});
