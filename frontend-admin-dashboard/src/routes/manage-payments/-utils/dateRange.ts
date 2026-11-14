/**
 * The date window shared by Manage Payments and the Payment Dashboard.
 *
 * Both screens used to own their own range control — a hidden Start/End pair inside the filters
 * slide-over on one, a 7d/30d/90d segmented switch on the other — so the same question ("how much
 * did we collect last month?") was asked in two different places, two different ways. This module
 * is the single definition of a window: presets, a custom range, the label to print on the
 * trigger, and the two serialisations the APIs want.
 */

export type DateRangePresetKey =
    | 'today'
    | 'yesterday'
    | '7d'
    | '30d'
    | '90d'
    | 'this_month'
    | 'last_month'
    | 'this_year'
    | 'last_year'
    | 'all'
    | 'custom';

export interface DateRangeValue {
    /** ISO UTC instant the window opens at. '' = unbounded (all time). */
    start: string;
    /** ISO UTC instant the window closes at. '' = unbounded. */
    end: string;
    preset: DateRangePresetKey;
}

export const ALL_TIME_RANGE: DateRangeValue = { start: '', end: '', preset: 'all' };

export const PRESET_OPTIONS: { key: Exclude<DateRangePresetKey, 'custom'>; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: '90d', label: 'Last 90 days' },
    { key: 'this_month', label: 'This month' },
    { key: 'last_month', label: 'Last month' },
    { key: 'this_year', label: 'This year' },
    { key: 'last_year', label: 'Last year' },
    { key: 'all', label: 'All time' },
];

const startOfDay = (d: Date): Date => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};

const endOfDay = (d: Date): Date => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
};

const shiftDays = (d: Date, days: number): Date => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
};

/**
 * Resolve a preset to a concrete window. Day boundaries are cut in the admin's own zone — "today"
 * has to mean their today, not UTC's — while the values handed to the API stay UTC instants.
 */
export const resolvePreset = (key: Exclude<DateRangePresetKey, 'custom'>): DateRangeValue => {
    const now = new Date();
    const iso = (d: Date) => d.toISOString();

    switch (key) {
        case 'today':
            return { start: iso(startOfDay(now)), end: iso(now), preset: key };
        case 'yesterday': {
            const yesterday = shiftDays(now, -1);
            return {
                start: iso(startOfDay(yesterday)),
                end: iso(endOfDay(yesterday)),
                preset: key,
            };
        }
        case '7d':
            return { start: iso(startOfDay(shiftDays(now, -6))), end: iso(now), preset: key };
        case '30d':
            return { start: iso(startOfDay(shiftDays(now, -29))), end: iso(now), preset: key };
        case '90d':
            return { start: iso(startOfDay(shiftDays(now, -89))), end: iso(now), preset: key };
        case 'this_month': {
            const first = new Date(now.getFullYear(), now.getMonth(), 1);
            return { start: iso(first), end: iso(now), preset: key };
        }
        case 'last_month': {
            const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const last = new Date(now.getFullYear(), now.getMonth(), 0);
            return { start: iso(first), end: iso(endOfDay(last)), preset: key };
        }
        case 'this_year':
            return { start: iso(new Date(now.getFullYear(), 0, 1)), end: iso(now), preset: key };
        case 'last_year': {
            const year = now.getFullYear() - 1;
            return {
                start: iso(new Date(year, 0, 1)),
                end: iso(endOfDay(new Date(year, 11, 31))),
                preset: key,
            };
        }
        case 'all':
        default:
            return { ...ALL_TIME_RANGE };
    }
};

/** A hand-picked window. Whole days: the first opens at 00:00, the last closes at 23:59:59.999. */
export const customRange = (from: Date, to: Date): DateRangeValue => {
    const [earlier, later] = from.getTime() <= to.getTime() ? [from, to] : [to, from];
    return {
        start: startOfDay(earlier).toISOString(),
        end: endOfDay(later).toISOString(),
        preset: 'custom',
    };
};

/** One whole calendar year, 1 Jan to 31 Dec — what an admin means by "2019". */
export const yearRange = (year: number): DateRangeValue =>
    customRange(new Date(year, 0, 1), new Date(year, 11, 31));

/**
 * The years offered as one-click chips, newest first. Ten years back covers institutes whose
 * migrated records go back to 2018, in two rows of five.
 */
export const recentYears = (count = 10): number[] => {
    const current = new Date().getFullYear();
    return Array.from({ length: count }, (_, i) => current - i);
};

const pad = (n: number) => String(n).padStart(2, '0');

/** A local day as the `YYYY-MM-DD` a native date input reads and writes. */
export const toDateInputValue = (d: Date | undefined): string =>
    d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';

/** The local day a native date input holds, or undefined while it is empty or half-typed. */
export const fromDateInputValue = (value: string): Date | undefined => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    // A browser date field reports the year digit by digit while it is typed (0002, 0020, 0201,
    // 2019), and `new Date` reads 0002 as 1902, so anything before 1900 is still being typed.
    if (!match || Number(match[1]) < 1900) return undefined;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(d.getTime()) ? undefined : d;
};

const parse = (iso: string): Date | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** The Date pair behind a value, for seeding the calendar (shaped like react-day-picker's DateRange). */
export const rangeDates = (
    value: DateRangeValue
): { from: Date | undefined; to: Date | undefined } => {
    const from = parse(value.start);
    const to = parse(value.end);
    return { from: from ?? undefined, to: to ?? undefined };
};

const dayLabel = (d: Date, withYear: boolean): string =>
    d.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        ...(withYear ? { year: 'numeric' } : {}),
    });

/** What the dropdown trigger reads — a preset's name, or the actual dates for a custom window. */
export const formatRangeLabel = (value: DateRangeValue): string => {
    if (value.preset !== 'custom') {
        return PRESET_OPTIONS.find((p) => p.key === value.preset)?.label ?? 'All time';
    }
    const from = parse(value.start);
    const to = parse(value.end);
    if (from && to) {
        const wholeYear =
            from.getFullYear() === to.getFullYear() &&
            from.getMonth() === 0 &&
            from.getDate() === 1 &&
            to.getMonth() === 11 &&
            to.getDate() === 31;
        if (wholeYear) return String(from.getFullYear());
        const sameDay = from.toDateString() === to.toDateString();
        if (sameDay) return dayLabel(from, true);
        const sameYear = from.getFullYear() === to.getFullYear();
        return `${dayLabel(from, !sameYear)} – ${dayLabel(to, true)}`;
    }
    if (from) return `From ${dayLabel(from, true)}`;
    if (to) return `Until ${dayLabel(to, true)}`;
    return 'All time';
};

/** True when the window is bounded on either side (i.e. not "all time"). */
export const isRangeActive = (value: DateRangeValue): boolean => Boolean(value.start || value.end);

/**
 * Serialisation for the endpoints that bind `LocalDateTime` (payment-logs, collection summary):
 * the UTC wall clock with the offset stripped, which is exactly how the backend reads it.
 */
export const rangeToLocalIsoWindow = (value: DateRangeValue): { start?: string; end?: string } => ({
    start: value.start ? value.start.slice(0, 19) : undefined,
    end: value.end ? value.end.slice(0, 19) : undefined,
});
