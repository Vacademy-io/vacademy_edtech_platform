import { describe, expect, it } from 'vitest';
import {
    formatConversationTime,
    formatDayLabel,
    groupMessagesByDay,
} from '@/routes/communication/inbox/-utils/day-labels';

/**
 * Every WhatsApp thread is read by date: an admin scrolling back needs to know whether a message
 * went out today or three weeks ago, and the Inbox used to give them only a clock time. The rules
 * are calendar rules, not duration rules — 23:55 last night is "Yesterday" at 00:05, not "an hour
 * ago" — so the tests are written against real calendar days rather than millisecond offsets.
 */
const NOW = new Date(2026, 8, 9, 14, 30); // Wednesday 9 September 2026, local time

function daysBefore(days: number, hour = 10): Date {
    return new Date(2026, 8, 9 - days, hour, 0);
}

describe('day separators', () => {
    it('names today and yesterday', () => {
        expect(formatDayLabel(daysBefore(0).toISOString(), NOW)).toBe('Today');
        expect(formatDayLabel(daysBefore(1).toISOString(), NOW)).toBe('Yesterday');
    });

    it('counts calendar days, so five minutes either side of midnight changes the label', () => {
        const lateLastNight = new Date(2026, 8, 8, 23, 55);
        const justAfterMidnight = new Date(2026, 8, 9, 0, 5);
        expect(formatDayLabel(lateLastNight.toISOString(), justAfterMidnight)).toBe('Yesterday');
        expect(formatDayLabel(justAfterMidnight.toISOString(), justAfterMidnight)).toBe('Today');
    });

    it('uses the weekday name for the rest of the week', () => {
        const monday = daysBefore(2);
        expect(formatDayLabel(monday.toISOString(), NOW)).toBe(
            monday.toLocaleDateString(undefined, { weekday: 'long' })
        );
    });

    it('falls back to a date once the week is out, with the year only when it differs', () => {
        const thisYear = daysBefore(30);
        expect(formatDayLabel(thisYear.toISOString(), NOW)).toBe(
            thisYear.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
        );

        const lastYear = new Date(2025, 7, 18, 10, 0);
        expect(formatDayLabel(lastYear.toISOString(), NOW)).toBe(
            lastYear.toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            })
        );
    });

    it('says nothing about a timestamp it cannot read', () => {
        expect(formatDayLabel(undefined, NOW)).toBe('');
        expect(formatDayLabel('not a date', NOW)).toBe('');
    });
});

describe('grouping a thread by day', () => {
    it('splits the thread where the calendar day changes, keeping order', () => {
        const messages = [
            { id: 'a', timestamp: daysBefore(2, 9).toISOString() },
            { id: 'b', timestamp: daysBefore(2, 18).toISOString() },
            { id: 'c', timestamp: daysBefore(0, 8).toISOString() },
        ];

        const groups = groupMessagesByDay(messages, NOW);

        expect(groups).toHaveLength(2);
        expect(groups[0]?.messages.map((m) => m.id)).toEqual(['a', 'b']);
        expect(groups[1]?.messages.map((m) => m.id)).toEqual(['c']);
        expect(groups[1]?.label).toBe('Today');
    });

    it('keeps an undated message with the run it arrived in instead of dropping it', () => {
        const groups = groupMessagesByDay(
            [{ id: 'a', timestamp: daysBefore(0).toISOString() }, { id: 'b' }],
            NOW
        );

        expect(groups).toHaveLength(1);
        expect(groups[0]?.messages.map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('gives a thread that opens with an undated message no separator to show', () => {
        const groups = groupMessagesByDay<{ id: string; timestamp?: string }>([{ id: 'a' }], NOW);
        expect(groups[0]?.label).toBe('');
    });

    it('has nothing to group in an empty thread', () => {
        expect(groupMessagesByDay([], NOW)).toEqual([]);
    });
});

describe('conversation row timestamps', () => {
    it('shows the clock time today and the day name inside the week', () => {
        const today = daysBefore(0, 11);
        expect(formatConversationTime(today.toISOString(), NOW)).toBe(
            today.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        );
        expect(formatConversationTime(daysBefore(1).toISOString(), NOW)).toBe('Yesterday');

        const monday = daysBefore(2);
        expect(formatConversationTime(monday.toISOString(), NOW)).toBe(
            monday.toLocaleDateString(undefined, { weekday: 'short' })
        );
    });

    it('shows a short date for anything older', () => {
        const old = daysBefore(40);
        expect(formatConversationTime(old.toISOString(), NOW)).toBe(
            old.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        );
    });

    it('renders nothing for a conversation with no last message', () => {
        expect(formatConversationTime(undefined, NOW)).toBe('');
    });
});
