import type { TFunction } from 'i18next';

/** Initials for an avatar fallback (first + last word). */
export const getInitials = (name?: string): string => {
    const cleaned = (name ?? '').trim();
    if (!cleaned) return '?';
    const parts = cleaned.split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase();
};

/** Plain-text snippet from rich-text HTML, for the inbox list preview. */
export const stripHtml = (html?: string): string => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

/**
 * Compact relative time ("5m", "3h", "2d", "4w", then a date). Called from render, so `t` and the
 * active language are threaded in from the caller's `useTranslation()` rather than resolved here.
 */
export const timeAgo = (
    iso: string | null | undefined,
    t: TFunction,
    language: string
): string => {
    if (!iso) return '';
    const time = new Date(iso).getTime();
    if (Number.isNaN(time)) return '';
    const mins = Math.floor((Date.now() - time) / 60000);
    if (mins < 1) return t('now');
    if (mins < 60) return t('minutesAgo', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t('daysAgo', { count: days });
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return t('weeksAgo', { count: weeks });
    return new Date(iso).toLocaleDateString(language, { day: '2-digit', month: 'short' });
};
