import { format, parseISO } from 'date-fns';

/**
 * A period as one short label, the way the day picker prints a day: "12 Oct – 29 Oct 2026",
 * "29 Oct 2026" for a single day, and the year on both ends when they differ.
 */
export function formatInboxPeriod(from: string, to: string): string {
    const end = format(parseISO(to), 'd MMM yyyy');
    if (from === to) return end;
    const start = parseISO(from);
    const sameYear = start.getFullYear() === parseISO(to).getFullYear();
    return `${format(start, sameYear ? 'd MMM' : 'd MMM yyyy')} – ${end}`;
}

/**
 * The period after one end moves. The other end follows when the move would cross it, so the
 * pair stays valid (from ≤ to) and a first pick gives a one-day period to widen from there.
 */
export function movePeriodEnd(
    current: { from?: string; to?: string },
    end: 'from' | 'to',
    day: string
): { from: string; to: string } {
    if (end === 'from') {
        return { from: day, to: current.to && current.to >= day ? current.to : day };
    }
    return { from: current.from && current.from <= day ? current.from : day, to: day };
}
