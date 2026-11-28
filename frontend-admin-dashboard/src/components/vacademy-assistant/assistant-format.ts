import type { AssistantChatSummary } from './types';

function parse(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

/** A message's time: just the time today, the date and time before that. '' when unknown. */
export function formatMessageTime(
    iso: string | null | undefined,
    locale: string,
    now: Date = new Date()
): string {
    const date = parse(iso);
    if (!date) return '';
    const options: Intl.DateTimeFormatOptions = sameDay(date, now)
        ? { hour: 'numeric', minute: '2-digit' }
        : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
    try {
        return new Intl.DateTimeFormat(locale || 'en', options).format(date);
    } catch {
        return new Intl.DateTimeFormat('en', options).format(date);
    }
}

/** A chat's last activity in the history list: the time today, the date before that. */
export function formatChatTime(
    iso: string | null | undefined,
    locale: string,
    now: Date = new Date()
): string {
    const date = parse(iso);
    if (!date) return '';
    const options: Intl.DateTimeFormatOptions = sameDay(date, now)
        ? { hour: 'numeric', minute: '2-digit' }
        : date.getFullYear() === now.getFullYear()
          ? { day: 'numeric', month: 'short' }
          : { day: 'numeric', month: 'short', year: 'numeric' };
    try {
        return new Intl.DateTimeFormat(locale || 'en', options).format(date);
    } catch {
        return new Intl.DateTimeFormat('en', options).format(date);
    }
}

/** Chats split into those active today (local time) and earlier ones, order kept. */
export function groupChatsByDay(
    chats: AssistantChatSummary[],
    now: Date = new Date()
): { today: AssistantChatSummary[]; earlier: AssistantChatSummary[] } {
    const today: AssistantChatSummary[] = [];
    const earlier: AssistantChatSummary[] = [];
    for (const chat of chats) {
        const date = parse(chat.last_active);
        (date && sameDay(date, now) ? today : earlier).push(chat);
    }
    return { today, earlier };
}

/** The first word of a full name, or '' when there is none. */
export function firstNameOf(fullName: string | null | undefined): string {
    return (fullName ?? '').trim().split(/\s+/)[0] ?? '';
}
