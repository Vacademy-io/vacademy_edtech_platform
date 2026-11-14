import { describe, expect, it } from 'vitest';
import { daysUntil, dueState, formatPlanDate, parsePlanDate } from '../planDates';
import { hideColumnsAddedLater } from '../hideColumnsAddedLater';

describe('parsePlanDate', () => {
    it('reads a plain day as that calendar day, never shifted by the zone', () => {
        const d = parsePlanDate('2026-09-28')!;
        expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 28]);
        expect(formatPlanDate('2026-08-31')).toBe('Aug 31, 2026');
    });

    it('reads an instant as the local day it falls on', () => {
        const instant = '2026-10-18T18:30:00Z';
        const local = new Date(instant);
        const d = parsePlanDate(instant)!;
        expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([
            local.getFullYear(),
            local.getMonth(),
            local.getDate(),
        ]);
    });

    it('has nothing to show for a missing or unreadable value', () => {
        expect(parsePlanDate(null)).toBeNull();
        expect(parsePlanDate('')).toBeNull();
        expect(formatPlanDate('not a date')).toBeNull();
    });
});

describe('dueState', () => {
    const now = new Date(2026, 8, 28, 23, 0);

    it('compares by calendar day', () => {
        expect(dueState('2026-09-27', now)).toBe('overdue');
        expect(dueState('2026-09-28', now)).toBe('today');
        expect(dueState('2026-10-15', now)).toBe('upcoming');
        expect(dueState(null, now)).toBeNull();
    });

    it('counts whole days either way', () => {
        expect(daysUntil('2026-10-15', now)).toBe(17);
        expect(daysUntil('2026-09-25', now)).toBe(-3);
    });
});

const memoryStorage = (init: Record<string, string> = {}): Storage => {
    const m = new Map(Object.entries(init));
    return {
        get length() {
            return m.size;
        },
        clear: () => m.clear(),
        getItem: (k) => (m.has(k) ? m.get(k)! : null),
        key: (i) => [...m.keys()][i] ?? null,
        removeItem: (k) => void m.delete(k),
        setItem: (k, v) => void m.set(k, v),
    };
};

describe('hideColumnsAddedLater', () => {
    const KEY = 'prefs';
    const FLAG = 'flag';
    const ADDED = ['enrolled_date', 'next_due_date'];

    it('hides the new columns for an admin who already saved a layout', () => {
        const s = memoryStorage({ [KEY]: JSON.stringify(['tracking_id']) });
        hideColumnsAddedLater(KEY, ADDED, FLAG, s);
        expect(JSON.parse(s.getItem(KEY)!)).toEqual([
            'tracking_id',
            'enrolled_date',
            'next_due_date',
        ]);
    });

    it('also hides them when the saved layout showed every column', () => {
        const s = memoryStorage({ [KEY]: '[]' });
        hideColumnsAddedLater(KEY, ADDED, FLAG, s);
        expect(JSON.parse(s.getItem(KEY)!)).toEqual(ADDED);
    });

    it('runs once, so switching a column on afterwards sticks', () => {
        const s = memoryStorage({ [KEY]: '[]' });
        hideColumnsAddedLater(KEY, ADDED, FLAG, s);
        s.setItem(KEY, JSON.stringify(['next_due_date'])); // admin ticks Enrollment Date
        hideColumnsAddedLater(KEY, ADDED, FLAG, s);
        expect(JSON.parse(s.getItem(KEY)!)).toEqual(['next_due_date']);
    });

    it('leaves a first-time visitor to the defaults', () => {
        const s = memoryStorage();
        hideColumnsAddedLater(KEY, ADDED, FLAG, s);
        expect(s.getItem(KEY)).toBeNull();
        expect(s.getItem(FLAG)).toBe('1');
    });
});
