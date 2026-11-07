import { addDays, format, parse, subDays } from 'date-fns';

/** Quick ranges on the dashboard. Past ranges end today; `next7` starts today. */
export type DashboardPreset = 'today' | 'last5' | 'last7' | 'last30' | 'next7';

export const DASHBOARD_PRESETS: DashboardPreset[] = ['today', 'last5', 'last7', 'last30', 'next7'];

/** Same ceiling the backend enforces (366 days, inclusive). */
export const MAX_DASHBOARD_RANGE_DAYS = 366;

const ISO = 'yyyy-MM-dd';

export const toIsoDate = (date: Date): string => format(date, ISO);

export const rangeForPreset = (
    preset: DashboardPreset,
    today: Date = new Date()
): { start: string; end: string } => {
    switch (preset) {
        case 'today':
            return { start: toIsoDate(today), end: toIsoDate(today) };
        case 'last5':
            return { start: toIsoDate(subDays(today, 4)), end: toIsoDate(today) };
        case 'last7':
            return { start: toIsoDate(subDays(today, 6)), end: toIsoDate(today) };
        case 'last30':
            return { start: toIsoDate(subDays(today, 29)), end: toIsoDate(today) };
        case 'next7':
            return { start: toIsoDate(today), end: toIsoDate(addDays(today, 6)) };
    }
};

/** The preset a range corresponds to, or null for a custom range. */
export const presetForRange = (
    start: string,
    end: string,
    today: Date = new Date()
): DashboardPreset | null =>
    DASHBOARD_PRESETS.find((p) => {
        const r = rangeForPreset(p, today);
        return r.start === start && r.end === end;
    }) ?? null;

/** Inclusive day count of a yyyy-MM-dd range; 0 when unparseable or reversed. */
export const rangeLengthDays = (start: string, end: string): number => {
    const s = parse(start, ISO, new Date());
    const e = parse(end, ISO, new Date());
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
    return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
};

export const EMPTY_VALUE = '—';

/** 0.482 → "48%". Null stays "—" so an empty denominator never reads as 0%. */
export const formatRate = (rate: number | null | undefined): string =>
    rate === null || rate === undefined || Number.isNaN(rate)
        ? EMPTY_VALUE
        : `${Math.round(rate * 100)}%`;

export const formatRating = (rating: number | null | undefined): string =>
    rating === null || rating === undefined ? EMPTY_VALUE : rating.toFixed(1);

export const formatCount = (value: number | null | undefined): string =>
    value === null || value === undefined
        ? EMPTY_VALUE
        : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value);

/**
 * 45 → "45m", 80 → "1h 20m", 120 → "2h". Unit suffixes come from the caller
 * so they follow the active language.
 */
export const formatDuration = (
    minutes: number | null | undefined,
    units: { h: string; m: string }
): string => {
    if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return EMPTY_VALUE;
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}${units.m}`;
    return m === 0 ? `${h}${units.h}` : `${h}${units.h} ${m}${units.m}`;
};

/** Traffic-light band for a rate: ≥75% good, ≥50% watch, below that poor. */
export type RateTone = 'success' | 'warning' | 'danger' | 'neutral';

export const rateTone = (rate: number | null | undefined): RateTone => {
    if (rate === null || rate === undefined) return 'neutral';
    if (rate >= 0.75) return 'success';
    if (rate >= 0.5) return 'warning';
    return 'danger';
};

/** Rating bands on the 5-star scale: ≥4 good, ≥3 watch. */
export const ratingTone = (rating: number | null | undefined): RateTone => {
    if (rating === null || rating === undefined) return 'neutral';
    if (rating >= 4) return 'success';
    if (rating >= 3) return 'warning';
    return 'danger';
};

/** Platform keys the backend emits — anything unknown is folded into "other". */
export const DASHBOARD_PLATFORMS = [
    'bbb',
    'youtube',
    'google meet',
    'zoom',
    'zoho',
    'recorded',
    'other',
] as const;

export type DashboardPlatform = (typeof DASHBOARD_PLATFORMS)[number];

export const platformKey = (platform: string): DashboardPlatform =>
    (DASHBOARD_PLATFORMS as readonly string[]).includes(platform)
        ? (platform as DashboardPlatform)
        : 'other';

/** i18n key suffix for a platform (keys cannot contain spaces reliably). */
export const platformLabelKey = (platform: string): string =>
    platformKey(platform).replace(' ', '_');
