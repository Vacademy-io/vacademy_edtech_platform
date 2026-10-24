import { describe, expect, it } from 'vitest';
import { dateRangeFileSuffix, dueDateWindow } from './due-range';
import { bucketWindow, intersectWindows } from './follow-up-buckets';

describe('dueDateWindow', () => {
    it('is no window when both dates are blank', () => {
        expect(dueDateWindow('', '')).toEqual({ from: undefined, to: undefined });
    });

    it('keeps the last day whole — `to` is the next local midnight', () => {
        const w = dueDateWindow('2026-10-01', '2026-10-07');
        expect(w.from).toBe(new Date('2026-10-01T00:00:00').toISOString());
        expect(w.to).toBe(new Date('2026-10-08T00:00:00').toISOString());
    });

    it('leaves the other end open when only one date is set', () => {
        expect(dueDateWindow('2026-10-01', '').to).toBeUndefined();
        expect(dueDateWindow('', '2026-10-07').from).toBeUndefined();
    });
});

describe('intersectWindows', () => {
    const now = new Date('2026-10-08T10:00:00');

    it('All + a range is exactly the range', () => {
        const due = dueDateWindow('2026-10-01', '2026-10-07');
        expect(intersectWindows(bucketWindow('all', now), due)).toEqual(due);
    });

    it('Pending + a range ending after now stops at now', () => {
        const due = dueDateWindow('2026-10-01', '2026-10-31');
        expect(intersectWindows(bucketWindow('overdue', now), due)).toEqual({
            from: due.from,
            to: now.toISOString(),
        });
    });

    it('Upcoming + a past range comes back empty (from after to)', () => {
        const w = intersectWindows(
            bucketWindow('upcoming', now),
            dueDateWindow('2026-09-01', '2026-09-30')
        );
        expect(w.from! > w.to!).toBe(true);
    });

    it('no due filter leaves the bucket window untouched', () => {
        expect(intersectWindows(bucketWindow('today', now), {})).toEqual(
            bucketWindow('today', now)
        );
    });
});

describe('dateRangeFileSuffix', () => {
    it('names the range, or nothing', () => {
        expect(dateRangeFileSuffix('2026-10-01', '2026-10-07')).toBe('_2026-10-01_to_2026-10-07');
        expect(dateRangeFileSuffix('2026-10-01', '')).toBe('_2026-10-01_to_end');
        expect(dateRangeFileSuffix('', '')).toBe('');
    });
});
