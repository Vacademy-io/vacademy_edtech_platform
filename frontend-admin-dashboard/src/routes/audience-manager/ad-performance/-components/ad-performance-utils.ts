/**
 * Pure helpers for the Ad performance screen: the report window for each range preset,
 * number / currency / date formatting, the per-day chart series and the sort order of
 * the platform table. No React here, so everything is easy to reason about and test.
 */
import {
    addDays,
    differenceInCalendarDays,
    format,
    isValid,
    parseISO,
    startOfWeek,
    subDays,
} from 'date-fns';
import type {
    AdAccount,
    AdPerformanceCampaign,
    AdPerformanceDaily,
    AdPerformancePlatform,
    AdPlatform,
} from '../../-marketing/types';
import { AD_PLATFORMS } from '../../-marketing/platform-meta';
import type { AdMetric, AdRange } from '../index';

export const DEFAULT_RANGE: AdRange = '30d';
export const DEFAULT_METRIC: AdMetric = 'enquiries';
/** The server rejects windows longer than this (inclusive days). */
export const MAX_RANGE_DAYS = 400;
/** Above this many days the chart groups bars by week so they stay readable. */
export const WEEKLY_THRESHOLD_DAYS = 92;
/** Indian academic year starts on 1 April (month index 3). */
const SEASON_START_MONTH = 3;

const DAY = 'yyyy-MM-dd';

export const toDayString = (date: Date) => format(date, DAY);

function parseDay(value: string | undefined): Date | null {
    if (!value) return null;
    const date = parseISO(value);
    return isValid(date) ? date : null;
}

/** 1 April of the academic year `today` falls in (before April → the previous year). */
export function seasonStart(today: Date): Date {
    const year =
        today.getMonth() >= SEASON_START_MONTH ? today.getFullYear() : today.getFullYear() - 1;
    return new Date(year, SEASON_START_MONTH, 1);
}

export interface ReportWindow {
    range: AdRange;
    /** yyyy-MM-dd, inclusive */
    from: string;
    /** yyyy-MM-dd, inclusive */
    to: string;
}

/**
 * The inclusive window for a preset. A custom range with missing or reversed dates falls
 * back to the last 30 days; one longer than the server limit is shortened from the start.
 */
export function resolveWindow(
    range: AdRange | undefined,
    from: string | undefined,
    to: string | undefined,
    today: Date = new Date()
): ReportWindow {
    const end = toDayString(today);
    switch (range ?? DEFAULT_RANGE) {
        case '7d':
            return { range: '7d', from: toDayString(subDays(today, 6)), to: end };
        case 'season':
            return { range: 'season', from: toDayString(seasonStart(today)), to: end };
        case 'custom': {
            const start = parseDay(from);
            const stop = parseDay(to);
            if (start && stop && start <= stop) {
                const span = differenceInCalendarDays(stop, start) + 1;
                const clampedStart =
                    span > MAX_RANGE_DAYS ? subDays(stop, MAX_RANGE_DAYS - 1) : start;
                return { range: 'custom', from: toDayString(clampedStart), to: toDayString(stop) };
            }
            return { range: '30d', from: toDayString(subDays(today, 29)), to: end };
        }
        case '30d':
        default:
            return { range: '30d', from: toDayString(subDays(today, 29)), to: end };
    }
}

export function windowDays(from: string, to: string): number {
    const start = parseDay(from);
    const stop = parseDay(to);
    if (!start || !stop) return 0;
    return Math.max(0, differenceInCalendarDays(stop, start) + 1);
}

// ── Formatting ──────────────────────────────────────────────────────────────

const LOCALE = 'en-IN';
const EMPTY = '—';

const currencyFormatters = new Map<string, Intl.NumberFormat>();
const compactCurrencyFormatters = new Map<string, Intl.NumberFormat>();
const countFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const compactCountFormatter = new Intl.NumberFormat(LOCALE, {
    notation: 'compact',
    maximumFractionDigits: 1,
});

function currencyFormatter(currency: string, compact: boolean): Intl.NumberFormat {
    const cache = compact ? compactCurrencyFormatters : currencyFormatters;
    const cached = cache.get(currency);
    if (cached) return cached;
    let formatter: Intl.NumberFormat;
    try {
        formatter = new Intl.NumberFormat(LOCALE, {
            style: 'currency',
            currency,
            maximumFractionDigits: compact ? 1 : 0,
            ...(compact ? { notation: 'compact' as const } : {}),
        });
    } catch {
        // Unknown currency code from an ad account: show the number with the code after it.
        formatter = compact ? compactCountFormatter : countFormatter;
    }
    cache.set(currency, formatter);
    return formatter;
}

function knownCurrency(currency: string): boolean {
    try {
        new Intl.NumberFormat(LOCALE, { style: 'currency', currency });
        return true;
    } catch {
        return false;
    }
}

/** ₹4,16,100 — whole units, Indian grouping. Null / non-finite → an em dash. */
export function formatMoney(value: number | null | undefined, currency: string): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
    const text = currencyFormatter(currency, false).format(value);
    return knownCurrency(currency) ? text : `${text} ${currency}`;
}

/** ₹4.2L — for chart axes. */
export function formatMoneyCompact(value: number, currency: string): string {
    if (!Number.isFinite(value)) return EMPTY;
    const text = currencyFormatter(currency, true).format(value);
    return knownCurrency(currency) ? text : `${text} ${currency}`;
}

export function formatCount(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
    return countFormatter.format(value);
}

export function formatCountCompact(value: number): string {
    return Number.isFinite(value) ? compactCountFormatter.format(value) : EMPTY;
}

/** "3 Oct" in the viewer's language. */
export function formatShortDay(day: string, language: string): string {
    const date = parseDay(day);
    if (!date) return day;
    try {
        return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(date);
    } catch {
        return format(date, 'd MMM');
    }
}

/** "Fri, 3 Oct 2026" in the viewer's language. */
export function formatLongDay(day: string, language: string): string {
    const date = parseDay(day);
    if (!date) return day;
    try {
        return new Intl.DateTimeFormat(language, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        }).format(date);
    } catch {
        return format(date, 'EEE, d MMM yyyy');
    }
}

/** "5 minutes ago" in the viewer's language; null when the instant is missing or invalid. */
export function formatRelativeTime(
    iso: string | null | undefined,
    language: string,
    now: Date = new Date()
): string | null {
    if (!iso) return null;
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return null;
    const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
    const abs = Math.abs(seconds);
    let rtf: Intl.RelativeTimeFormat;
    try {
        rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    } catch {
        rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    }
    if (abs < 60) return rtf.format(0, 'second');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
    return rtf.format(Math.round(seconds / 86_400), 'day');
}

/** Absolute timestamp for a tooltip, e.g. "9 Nov 2026, 18:45". */
export function formatTimestamp(iso: string | null | undefined, language: string): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    try {
        return new Intl.DateTimeFormat(language, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(date);
    } catch {
        return format(date, 'd MMM yyyy, HH:mm');
    }
}

// ── Accounts ────────────────────────────────────────────────────────────────

/** Needs the admin to sign in again (or the last sync failed outright). */
export function accountNeedsAttention(account: AdAccount): boolean {
    return (
        account.status === 'ERROR' ||
        account.connection_status === 'RECONNECT_NEEDED' ||
        account.connection_status === 'REVOKED'
    );
}

/** Connected but no data fetched yet: the first backfill is still running. */
export function accountFirstSyncPending(account: AdAccount): boolean {
    return account.status === 'ACTIVE' && !account.last_synced_at;
}

export function latestSync(accounts: AdAccount[]): string | null {
    let latest: string | null = null;
    let latestMs = -Infinity;
    for (const account of accounts) {
        if (!account.last_synced_at) continue;
        const ms = new Date(account.last_synced_at).getTime();
        if (Number.isFinite(ms) && ms > latestMs) {
            latestMs = ms;
            latest = account.last_synced_at;
        }
    }
    return latest;
}

// ── Chart series ────────────────────────────────────────────────────────────

export type ChartRow = { key: string; label: string; tooltipLabel: string } & Record<
    AdPlatform,
    number
>;

/**
 * One row per day of the window (or per week when the window is long), with a value per
 * platform for the chosen metric. Days without data are zero so gaps read as gaps.
 */
export function buildChartRows(
    daily: AdPerformanceDaily[],
    from: string,
    to: string,
    metric: AdMetric,
    weekly: boolean,
    language: string,
    weekOfLabel: (day: string) => string
): ChartRow[] {
    const start = parseDay(from);
    const stop = parseDay(to);
    if (!start || !stop || start > stop) return [];

    const bucketOf = (date: Date) =>
        weekly ? toDayString(startOfWeek(date, { weekStartsOn: 1 })) : toDayString(date);

    const rows = new Map<string, ChartRow>();
    for (let date = start; date <= stop; date = addDays(date, 1)) {
        const key = bucketOf(date);
        if (rows.has(key)) continue;
        // A week that starts before the window is labelled by its first day in the window.
        const labelDay = key < from ? from : key;
        rows.set(key, {
            key,
            label: formatShortDay(labelDay, language),
            tooltipLabel: weekly ? weekOfLabel(labelDay) : formatLongDay(key, language),
            META: 0,
            GOOGLE: 0,
            YOUTUBE: 0,
        });
    }

    for (const point of daily) {
        const date = parseDay(point.day);
        if (!date) continue;
        const row = rows.get(bucketOf(date));
        if (!row || !AD_PLATFORMS.includes(point.platform)) continue;
        const value = Number(point[metric]) || 0;
        row[point.platform] += value;
    }
    return Array.from(rows.values());
}

/** Platforms that have anything to draw for the metric, in report order. */
export function platformsWithData(rows: ChartRow[]): AdPlatform[] {
    return AD_PLATFORMS.filter((platform) => rows.some((row) => row[platform] > 0));
}

// ── Table ───────────────────────────────────────────────────────────────────

export type SortKey = 'name' | 'spend' | 'clicks' | 'enquiries' | 'cost_per_enquiry' | 'admissions';
export type SortDirection = 'asc' | 'desc';
export interface SortState {
    key: SortKey;
    direction: SortDirection;
}

export const DEFAULT_SORT: SortState = { key: 'admissions', direction: 'desc' };

type Sortable = Pick<
    AdPerformancePlatform,
    'spend' | 'clicks' | 'enquiries' | 'cost_per_enquiry' | 'admissions'
>;

/** Compares two rows; a missing cost always sorts last, whatever the direction. */
export function compareRows<T extends Sortable>(
    a: T,
    b: T,
    sort: SortState,
    nameOf: (row: T) => string
): number {
    const sign = sort.direction === 'asc' ? 1 : -1;
    if (sort.key === 'name') return sign * nameOf(a).localeCompare(nameOf(b));
    const left = a[sort.key];
    const right = b[sort.key];
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (left !== right) return sign * (left - right);
    // Stable, meaningful tie-break: more admissions, then more enquiries, then spend.
    return b.admissions - a.admissions || b.enquiries - a.enquiries || b.spend - a.spend;
}

/** Google channel types ordered by how much was spent on them, for the row subtitle. */
export function channelMix(campaigns: AdPerformanceCampaign[], platform: AdPlatform): string[] {
    const spendByChannel = new Map<string, number>();
    for (const campaign of campaigns) {
        if (campaign.platform !== platform || !campaign.channel) continue;
        spendByChannel.set(
            campaign.channel,
            (spendByChannel.get(campaign.channel) ?? 0) + (Number(campaign.spend) || 0)
        );
    }
    return Array.from(spendByChannel.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([channel]) => channel);
}
