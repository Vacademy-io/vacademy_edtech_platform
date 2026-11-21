import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dueLabel } from '../../followup-reminders';

describe('dueLabel', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 29, 14, 30, 0));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const at = (d: Date) => d.toISOString();

    it('by default a time passed earlier today is overdue by the hour, as before', () => {
        expect(dueLabel(at(new Date(2026, 9, 29, 10, 0, 0)))).toEqual({
            text: 'Overdue by 4h',
            tone: 'overdue',
        });
    });

    it('with overdue-by-date, earlier today reads "Due today"', () => {
        expect(dueLabel(at(new Date(2026, 9, 29, 10, 0, 0)), true)).toEqual({
            text: 'Due today',
            tone: 'now',
        });
    });

    it('with overdue-by-date, a past date is overdue in calendar days', () => {
        expect(dueLabel(at(new Date(2026, 9, 28, 23, 0, 0)), true)).toEqual({
            text: 'Overdue by 1d',
            tone: 'overdue',
        });
        expect(dueLabel(at(new Date(2026, 9, 26, 9, 0, 0)), true)).toEqual({
            text: 'Overdue by 3d',
            tone: 'overdue',
        });
    });

    it('upcoming times are unchanged by the setting', () => {
        const soon = at(new Date(2026, 9, 29, 14, 40, 0));
        expect(dueLabel(soon, true)).toEqual(dueLabel(soon));
    });
});
