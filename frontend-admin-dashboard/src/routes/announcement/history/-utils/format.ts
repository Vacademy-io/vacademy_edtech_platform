import { parseUtcDate } from '@/utils/dateUtils';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
});

// en-US keeps the day period upper-case ("10:42 PM"); en-GB/en-IN print "pm".
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
});

export type DateParts = { date: string; time: string };

function toParts(d: Date): DateParts | null {
    if (Number.isNaN(d.getTime())) return null;
    return { date: DATE_FORMAT.format(d), time: TIME_FORMAT.format(d) };
}

// createdAt / deliveredAt / readAt / dismissedAt are UTC LocalDateTime strings without an offset.
export function utcParts(v?: string | null): DateParts | null {
    if (!v) return null;
    return toParts(parseUtcDate(v));
}

// Scheduling start/end are wall-clock times in the announcement's own timezone, so they are
// shown as-is rather than parsed as UTC.
export function wallClockParts(v?: string | null): DateParts | null {
    if (!v) return null;
    return toParts(new Date(v));
}

/** "08 Oct 2026, 10:42 PM", or "-" when there is no value. */
export function joinParts(p: DateParts | null): string {
    return p ? `${p.date}, ${p.time}` : '-';
}

/** SYSTEM_ALERT → "System alert". Fallback label for enum values with no catalog entry. */
export function humanize(value?: string | null): string {
    if (!value) return '-';
    const words = value.toLowerCase().split('_').filter(Boolean).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export function percent(n?: number): string {
    if (typeof n !== 'number' || Number.isNaN(n)) return '-';
    return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

export function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0]?.charAt(0) ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? '' : '';
    return (first + last).toUpperCase();
}
