/**
 * How WhatsApp itself stamps a message with when it happened: a chip between days rather than a
 * date on every bubble, and a list timestamp that gets vaguer as the conversation gets older.
 *
 * Everything here is calendar-based, not duration-based — a message sent at 23:55 is "Yesterday"
 * at 00:05, not "3 hours ago", which is the distinction a plain millisecond diff gets wrong.
 *
 * This is a plain utility module, not a component/hook, so `useTranslation()` cannot be called
 * here. The i18next singleton is used directly instead (same pattern as
 * settings/-components/Payment/utils/utils.ts) — see the shared i18n rollout guide.
 */
import i18next from 'i18next';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight-to-midnight distance: 0 today, 1 yesterday, regardless of the clock time on either. */
function calendarDaysAgo(then: Date, now: Date): number {
    const thenMidnight = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((nowMidnight - thenMidnight) / MS_PER_DAY);
}

function parse(timestamp?: string): Date | null {
    if (!timestamp) return null;
    const d = new Date(timestamp);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Identity of the calendar day a message belongs to — what the day separators are grouped on. */
export function dayKey(timestamp?: string): string | null {
    const d = parse(timestamp);
    return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
}

/**
 * The separator between two days of a conversation: "Today", "Yesterday", the weekday name for
 * anything else inside the last week ("Monday"), then the date — with the year only once it is no
 * longer the current one, exactly as WhatsApp does it.
 */
export function formatDayLabel(timestamp?: string, now: Date = new Date()): string {
    const d = parse(timestamp);
    if (!d) return '';

    const daysAgo = calendarDaysAgo(d, now);
    if (daysAgo === 0) return i18next.t('communicationDayLabels:today');
    if (daysAgo === 1) return i18next.t('communicationDayLabels:yesterday');
    if (daysAgo > 1 && daysAgo < 7)
        return d.toLocaleDateString(i18next.language, { weekday: 'long' });

    return d.toLocaleDateString(i18next.language, {
        day: 'numeric',
        month: 'long',
        // A future-dated row (clock skew) falls here too, and reads as a plain date rather than
        // as a lie about which day it was.
        ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    });
}

/** Clock time on a single message bubble. */
export function formatMessageTime(timestamp?: string): string {
    const d = parse(timestamp);
    return d
        ? d.toLocaleTimeString(i18next.language, { hour: '2-digit', minute: '2-digit' })
        : '';
}

/**
 * The right-hand timestamp on a conversation row: the time for today, then "Yesterday", then the
 * weekday for the rest of the week, then a short date. Same ladder as the day separators, one rung
 * shorter — a list row has no space for "18 August 2025".
 */
export function formatConversationTime(timestamp?: string, now: Date = new Date()): string {
    const d = parse(timestamp);
    if (!d) return '';

    const daysAgo = calendarDaysAgo(d, now);
    if (daysAgo === 0)
        return d.toLocaleTimeString(i18next.language, { hour: '2-digit', minute: '2-digit' });
    if (daysAgo === 1) return i18next.t('communicationDayLabels:yesterday');
    if (daysAgo > 1 && daysAgo < 7)
        return d.toLocaleDateString(i18next.language, { weekday: 'short' });

    return d.toLocaleDateString(i18next.language, {
        day: 'numeric',
        month: 'short',
        ...(d.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' }),
    });
}

export interface MessageDayGroup<T> {
    /** Calendar day identity, or '' for messages whose timestamp could not be read. */
    key: string;
    /** Separator text. Empty when the day is unknown, so no chip is drawn for it. */
    label: string;
    messages: T[];
}

/**
 * Split a chronological thread into per-day runs. Messages are assumed already ordered oldest
 * first, which is how the Inbox stores them; a message with no readable timestamp stays with the
 * run it arrived in rather than being dropped or given a separator of its own.
 */
export function groupMessagesByDay<T extends { timestamp?: string }>(
    messages: T[],
    now: Date = new Date()
): MessageDayGroup<T>[] {
    const groups: MessageDayGroup<T>[] = [];

    for (const message of messages) {
        const key = dayKey(message.timestamp);
        const current = groups[groups.length - 1];

        if (current && (key === null || current.key === key)) {
            current.messages.push(message);
            continue;
        }
        groups.push({
            key: key ?? '',
            label: key === null ? '' : formatDayLabel(message.timestamp, now),
            messages: [message],
        });
    }

    return groups;
}
