/**
 * Session date/time formatting, in one place so every mentorship surface agrees.
 *
 * `toLocaleString()` on its own produces "8/14/2026, 2:30:00 PM" — numeric, with
 * seconds nobody needs, and ambiguous between day/month conventions. These give a
 * scannable form instead, and split the parts so a row can lay a date block beside
 * the detail rather than running it all into one line.
 */

import type { TFunction } from 'i18next';

const isValid = (d: Date) => !Number.isNaN(d.getTime());

/** Day number, e.g. "14". */
export function dayOfMonth(epochMillis?: number | null): string {
    if (!epochMillis) return '–';
    const d = new Date(epochMillis);
    return isValid(d) ? String(d.getDate()) : '–';
}

/**
 * Short month, upper-cased for the date block, e.g. "AUG". `language` should be
 * the caller's `i18n.language` so the month name follows the app's chosen
 * locale rather than silently falling back to the browser's own locale.
 */
export function shortMonth(epochMillis?: number | null, language?: string): string {
    if (!epochMillis) return '';
    const d = new Date(epochMillis);
    return isValid(d) ? d.toLocaleString(language, { month: 'short' }).toUpperCase() : '';
}

/** Time only, e.g. "2:30 PM" — no seconds. Pass `i18n.language` for `language`. */
export function timeOfDay(epochMillis?: number | null, language?: string): string {
    if (!epochMillis) return '';
    const d = new Date(epochMillis);
    return isValid(d)
        ? d.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })
        : '';
}

/**
 * Weekday + date, e.g. "Thu 14 Aug". Year only when it isn't the current one.
 * Pass `i18n.language` for `language`.
 */
export function dayAndMonth(epochMillis?: number | null, language?: string): string {
    if (!epochMillis) return '';
    const d = new Date(epochMillis);
    if (!isValid(d)) return '';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(language, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
    });
}

/**
 * Full "Thu 14 Aug, 2:30 PM" for detail views and single-line summaries.
 * Pass `i18n.language` for `language`.
 */
export function sessionDateTime(epochMillis?: number | null, language?: string): string {
    if (!epochMillis) return '—';
    const date = dayAndMonth(epochMillis, language);
    const time = timeOfDay(epochMillis, language);
    return date && time ? `${date}, ${time}` : date || time || '—';
}

/**
 * Relative day label for grouping — "Today" / "Tomorrow" / "Yesterday", else the
 * date. Lets a list say when something is without the reader doing date arithmetic.
 *
 * `t` must come from the calling component/hook's `useTranslation()` — this is a
 * plain function, not a hook, so it cannot resolve translations on its own.
 * Uses the `mentorshipFormatSessionTimeUtils` namespace's `today`/`tomorrow`/
 * `yesterday` keys.
 */
export function relativeDay(epochMillis: number | null | undefined, t: TFunction, language?: string): string {
    if (!epochMillis) return '';
    const d = new Date(epochMillis);
    if (!isValid(d)) return '';
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
    if (days === 0) return t('mentorshipFormatSessionTimeUtils:today');
    if (days === 1) return t('mentorshipFormatSessionTimeUtils:tomorrow');
    if (days === -1) return t('mentorshipFormatSessionTimeUtils:yesterday');
    return dayAndMonth(epochMillis, language);
}
