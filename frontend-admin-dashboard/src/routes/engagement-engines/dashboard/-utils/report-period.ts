import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import type { ReportPeriod } from '@/services/engagement-daily-report';

/*
 * The period of a report: one day or a range of days, in the institute time zone. Shared by
 * the report, the Leads & outcomes page and their routes, so it stays light (dayjs and types
 * only): the route files import it eagerly.
 *
 * In the URL a single day is `?date=yyyy-MM-dd` and a range is `?from=&to=` (both included, the
 * `date` dropped). A preset such as "Last 7 days" is stored as the concrete days it was on the
 * day it was picked, so a shared link keeps showing the same numbers.
 */

export type { ReportPeriod };

const ISO = 'YYYY-MM-DD';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Days the report can reach back, counting today: "Last 90 days" is the whole window. */
export const REPORT_WINDOW_DAYS = 90;

export const shiftDay = (iso: string, days: number): string =>
    dayjs(iso).add(days, 'day').format(ISO);

const isIsoDay = (value: unknown): value is string =>
    typeof value === 'string' && ISO_DAY.test(value);

// ─── the URL ────────────────────────────────────────────────────────────────

export interface PeriodSearch {
    date?: string;
    from?: string;
    to?: string;
}

/**
 * The period params of a route's `validateSearch`. A range needs both ends (a lone `from` or
 * `to` is dropped), a reversed one is turned around, and a range of one day is that day.
 * `from`/`to` win over `date`, as on the server.
 */
export const normalizePeriodSearch = (search: Record<string, unknown>): PeriodSearch => {
    const { date, from, to } = search;
    if (isIsoDay(from) && isIsoDay(to)) {
        const [first, last] = from <= to ? [from, to] : [to, from];
        return first === last ? { date: first } : { from: first, to: last };
    }
    return isIsoDay(date) ? { date } : {};
};

/** The period a URL names; null = none (today). */
export const periodOfSearch = (search: PeriodSearch): ReportPeriod | null => {
    if (search.from && search.to) return { from: search.from, to: search.to };
    return search.date ? { from: search.date, to: search.date } : null;
};

/**
 * The URL params for a period. With `today`, a single day that is today is left out (no day
 * means today), which keeps the report's own URL short; without it the day is always written.
 */
export const searchOfPeriod = (period: ReportPeriod, today?: string): PeriodSearch => {
    if (period.from === period.to) return period.from === today ? {} : { date: period.from };
    return { from: period.from, to: period.to };
};

/**
 * The same, with all three keys present, to spread over a search that may still hold the
 * previous period (an absent key would leave the old value behind).
 */
export const periodPatch = (
    period: ReportPeriod,
    today?: string
): { date: string | undefined; from: string | undefined; to: string | undefined } => ({
    date: undefined,
    from: undefined,
    to: undefined,
    ...searchOfPeriod(period, today),
});

// ─── arithmetic ─────────────────────────────────────────────────────────────

/** A day as a whole number of days since 1970, so differences ignore daylight saving. */
const dayNumber = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.floor(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000);
};

/** How many days a period has, both ends included (1 for a single day). */
export const periodDays = (period: ReportPeriod): number =>
    Math.max(1, dayNumber(period.to) - dayNumber(period.from) + 1);

export const isSingleDay = (period: ReportPeriod): boolean => period.from === period.to;

export const samePeriod = (a: ReportPeriod, b: ReportPeriod): boolean =>
    a.from === b.from && a.to === b.to;

/** The earliest day the report can show: the first day of the 90-day window ending today. */
export const windowStart = (today: string): string => shiftDay(today, -(REPORT_WINDOW_DAYS - 1));

const clampDay = (day: string, min: string, max: string): string =>
    day < min ? min : day > max ? max : day;

/** The part of a period that lies inside [min, max]; one that lies wholly outside becomes the nearest edge day. */
export const clampPeriod = (period: ReportPeriod, min: string, max: string): ReportPeriod => ({
    from: clampDay(period.from, min, max),
    to: clampDay(period.to, min, max),
});

/** The period just before this one, of the same length. */
export const previousPeriod = (period: ReportPeriod): ReportPeriod => {
    const days = periodDays(period);
    return { from: shiftDay(period.from, -days), to: shiftDay(period.from, -1) };
};

/**
 * Moves a period by its own length (-1 = earlier, 1 = later). At the edge of [min, max] it
 * stops there and keeps its length, so the arrows never make a period shorter.
 */
export const shiftPeriod = (
    period: ReportPeriod,
    direction: -1 | 1,
    min: string,
    max: string
): ReportPeriod => {
    const days = periodDays(period);
    let from = shiftDay(period.from, direction * days);
    let to = shiftDay(period.to, direction * days);
    if (from < min) {
        from = min;
        to = shiftDay(min, days - 1);
    }
    if (to > max) {
        to = max;
        from = shiftDay(max, -(days - 1));
    }
    return clampPeriod({ from, to }, min, max);
};

/** False at the edge of the window, where an arrow has nowhere to go. */
export const canShift = (
    period: ReportPeriod,
    direction: -1 | 1,
    min: string,
    max: string
): boolean => (direction < 0 ? period.from > min : period.to < max);

// ─── presets ────────────────────────────────────────────────────────────────

export const PERIOD_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'last90'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/** How many days a "Last N days" preset covers. */
export const PRESET_DAYS: Partial<Record<PeriodPreset, number>> = {
    last7: 7,
    last30: 30,
    last90: REPORT_WINDOW_DAYS,
};

/** A preset as concrete days, given the institute's today. */
export const presetPeriod = (preset: PeriodPreset, today: string): ReportPeriod => {
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'yesterday') {
        const day = shiftDay(today, -1);
        return { from: day, to: day };
    }
    const days = PRESET_DAYS[preset] ?? 1;
    return clampPeriod(
        { from: shiftDay(today, -(days - 1)), to: today },
        windowStart(today),
        today
    );
};

/** The preset a period is exactly, if any. */
export const presetOf = (period: ReportPeriod, today: string): PeriodPreset | null =>
    PERIOD_PRESETS.find((p) => samePeriod(presetPeriod(p, today), period)) ?? null;

// ─── words ──────────────────────────────────────────────────────────────────

/**
 * The days of a period as text. `full` is "29 Oct 2026" or "12 Oct – 29 Oct 2026" (the year
 * is on the first day too when it differs); `compact` leaves the year out: "29 Oct",
 * "23–29 Oct", "28 Sep – 4 Oct" (the year comes back when the period crosses a year).
 */
export const formatPeriodDates = (
    period: ReportPeriod,
    style: 'full' | 'compact' = 'full'
): string => {
    const first = dayjs(period.from);
    const last = dayjs(period.to);
    const sameYear = first.year() === last.year();
    if (isSingleDay(period)) return last.format(style === 'full' ? 'D MMM YYYY' : 'D MMM');
    if (style === 'full') {
        return `${first.format(sameYear ? 'D MMM' : 'D MMM YYYY')} – ${last.format('D MMM YYYY')}`;
    }
    if (sameYear && first.month() === last.month()) {
        return `${first.format('D')}–${last.format('D MMM')}`;
    }
    return sameYear
        ? `${first.format('D MMM')} – ${last.format('D MMM')}`
        : `${first.format('D MMM YYYY')} – ${last.format('D MMM YYYY')}`;
};

/**
 * What the period button says: "29 Oct 2026", "12 Oct – 29 Oct 2026", and for a preset that
 * spans days "Last 7 days · 23–29 Oct".
 */
export const periodLabel = (period: ReportPeriod, today: string, t: TFunction): string => {
    const preset = presetOf(period, today);
    const days = preset ? PRESET_DAYS[preset] : undefined;
    return days
        ? `${t('period.preset.last', { count: days })} · ${formatPeriodDates(period, 'compact')}`
        : formatPeriodDates(period, 'full');
};

/** The period in a file name: the day, or `<from>_to_<to>` for a range. */
export const periodFileTag = (period: ReportPeriod): string =>
    isSingleDay(period) ? period.from : `${period.from}_to_${period.to}`;
