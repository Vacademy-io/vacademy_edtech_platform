import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import { pctChange } from '@/routes/dashboard/-utils/crm-dashboard';
import type { DailyReportTrendPoint } from '@/services/engagement-daily-report';

export { formatMinutes, formatNumber, humanizeKey } from '@/routes/dashboard/-utils/crm-dashboard';

/** The report can go this many days back. */
export const MAX_DAYS_BACK = 90;
/** How long a reply can still arrive after a message, so recent days keep changing. */
export const REPLY_WINDOW_DAYS = 3;

export const DASH = '—';

const ISO = 'YYYY-MM-DD';

/** Today's calendar day in one time zone, as yyyy-MM-dd. */
const dayInZone = (timeZone?: string): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
};

/**
 * Today in the institute's time zone (the report's `timezone`), which is what the server
 * means by "today". Before the first response, or when the zone is not a valid IANA name,
 * it falls back to the browser's zone.
 */
export const todayIso = (timeZone?: string | null): string => {
    try {
        return dayInZone(timeZone || undefined);
    } catch {
        return dayInZone(undefined);
    }
};
export const shiftDay = (iso: string, days: number) => dayjs(iso).add(days, 'day').format(ISO);
/** The earliest day the report can show: MAX_DAYS_BACK days before the institute's today. */
export const minDateIso = (timeZone?: string | null): string =>
    shiftDay(todayIso(timeZone), -MAX_DAYS_BACK);
/** Whole days between `iso` and the institute's today (0 = today). */
export const daysAgo = (iso: string, timeZone?: string | null): number =>
    dayjs(todayIso(timeZone)).diff(dayjs(iso), 'day');
export const formatDay = (iso: string) => (iso ? dayjs(iso).format('D MMM YYYY') : DASH);

const isNum = (n: number | null | undefined): n is number =>
    n !== null && n !== undefined && Number.isFinite(n);

/** Credits can be fractional: 578 stays "578", 48.2 stays "48.2". */
export const formatCredits = (n: number | null | undefined): string =>
    isNum(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : DASH;

/** A ratio from 0 to 1 as a percentage: 0.07 is "7%", 0.075 is "7.5%", 0.123 is "12%". */
export const formatRate = (ratio: number | null | undefined): string => {
    if (!isNum(ratio)) return DASH;
    const pct = ratio * 100;
    return `${pct < 10 && !Number.isInteger(pct) ? pct.toFixed(1) : Math.round(pct)}%`;
};

/** Time of day in one time zone, as HH:mm; empty when the instant cannot be read. */
export const formatTimeInZone = (iso: string, timeZone?: string | null): string => {
    const instant = new Date(iso);
    if (!iso || Number.isNaN(instant.getTime())) return '';
    const format = (zone?: string) =>
        new Intl.DateTimeFormat('en-GB', {
            timeZone: zone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(instant);
    try {
        return format(timeZone || undefined);
    } catch {
        return format(undefined);
    }
};

/** A timestamp from the server (ISO, UTC) as a Date; null when it is empty or unreadable. */
const instantOf = (iso: string | null | undefined): Date | null => {
    if (!iso) return null;
    const instant = new Date(iso);
    return Number.isNaN(instant.getTime()) ? null : instant;
};

const inZone = (
    instant: Date,
    options: Intl.DateTimeFormatOptions,
    locale: string,
    zone?: string | null
) => {
    try {
        return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone || undefined }).format(
            instant
        );
    } catch {
        // Not a valid IANA zone: fall back to the browser's.
        return new Intl.DateTimeFormat(locale, options).format(instant);
    }
};

/** "30 Oct 2026, 14:05" in one time zone; a dash when there is no (readable) time. */
export const formatDateTimeInZone = (
    iso: string | null | undefined,
    timeZone?: string | null
): string => {
    const instant = instantOf(iso);
    if (!instant) return DASH;
    return inZone(
        instant,
        {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        },
        'en-GB',
        timeZone
    );
};

/** "2026-10-30 14:05" in one time zone, the way a spreadsheet sorts it; empty when unreadable. */
export const formatStampInZone = (
    iso: string | null | undefined,
    timeZone?: string | null
): string => {
    const instant = instantOf(iso);
    if (!instant) return '';
    return inZone(
        instant,
        {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        },
        'sv-SE',
        timeZone
    );
};

/** Money in its own currency; small amounts keep up to four decimals. */
export const formatMoney = (amount: number | null | undefined, currency: string | null): string => {
    if (!isNum(amount)) return DASH;
    if (!currency) return formatCredits(amount);
    try {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: amount !== 0 && Math.abs(amount) < 1 ? 4 : 2,
        }).format(amount);
    } catch {
        return `${currency} ${amount.toFixed(2)}`;
    }
};

/** Same, with "at least" in front when the total leaves out messages that have no rate. */
export const formatMoneyPartial = (
    amount: number | null | undefined,
    currency: string | null,
    partial: boolean | undefined,
    t: TFunction
): string => {
    const text = formatMoney(amount, currency);
    return partial && isNum(amount) ? t('atLeast', { value: text }) : text;
};

/** 45 is "45s", 135 is "2m 15s". */
export const formatDuration = (seconds: number | null | undefined): string => {
    if (!isNum(seconds)) return DASH;
    const total = Math.round(seconds);
    if (total < 60) return `${total}s`;
    return `${Math.floor(total / 60)}m ${total % 60}s`;
};

/** The trend entry for the day before `date`, if the 7-day trend reaches that far. */
export const previousDayPoint = (
    trend: DailyReportTrendPoint[],
    date: string
): DailyReportTrendPoint | null => {
    if (!date) return null;
    const prev = shiftDay(date, -1);
    return trend.find((p) => p.date === prev) ?? null;
};

/** % change against the previous day, or null when there is nothing to compare with. */
export const deltaAgainst = (current: number, previous: number | null | undefined) =>
    pctChange(current, previous ?? null);

/** "Support Team Engine!" becomes "support-team-engine"; nothing Latin left gives "". */
export const fileSlug = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/**
 * engagement-report-<engine>-<date>.xlsx. An engine whose name has no Latin letters or digits
 * (so its slug is empty) is named by the first 8 characters of its id; "all" is only for the
 * all-engines report.
 */
export const exportFileName = (
    engineName: string,
    date: string,
    ext: 'xlsx' | 'pdf',
    engineId?: string | null
): string => {
    const slug =
        fileSlug(engineName) || (engineId ? fileSlug(engineId.slice(0, 8)) || 'engine' : 'all');
    return `engagement-report-${slug}-${date}.${ext}`;
};
