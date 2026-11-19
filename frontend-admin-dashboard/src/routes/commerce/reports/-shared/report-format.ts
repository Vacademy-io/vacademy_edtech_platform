import { formatMoney } from '@/components/design-system/money-cell';
import { formatNumber, getActiveLocale } from '@/lib/formatters';
import { asRecord, num, str } from '@/routes/commerce/-shared/commerce-api';
import type { ReportCell, ReportColumnType } from './report-types';

/**
 * How report cells read on screen (contract §7.2 `report-format.ts`).
 *
 * Report cells come from `export/ReportTable.java`: DATE is an India date
 * `yyyy-MM-dd`, TIME is India wall-clock text `yyyy-MM-dd HH:mm` (or "—" for
 * an event with a date and no time). Both are printed as they are, only
 * re-worded ("19 Nov 2026, 14:05"): never moved to another time zone.
 *
 * QTY is a number already in display units; the unit travels in its own
 * `*_text` column ("5.9 m"), which the table shows instead (`report-columns.ts`).
 * Money is drawn only by `MoneyCell` (design system); this file never adds
 * two amounts.
 *
 * `as_of` (an ISO instant with offset) is the only real instant: it alone goes
 * through `readInstant` and the fixed +05:30 offset.
 */

/** India's offset from UTC in minutes (+05:30, no summer time). */
export const INDIA_OFFSET_MINUTES = 330;
const MINUTE_MS = 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A server time as a Date. Stored timestamps may come without an offset
 * (`2026-11-18T10:15:30`): they are UTC wall times (contract §3.1), so `Z` is added.
 */
export function readInstant(value: unknown): Date | null {
    const text = str(value);
    if (!text || DATE_ONLY.test(text)) return null;
    const iso = /T\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? `${text}Z` : text;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** The India calendar day of an instant as `YYYY-MM-DD`. */
export function indiaDay(value: Date | string): string | null {
    const date = typeof value === 'string' ? readInstant(value) : value;
    if (!date || Number.isNaN(date.getTime())) return null;
    return new Date(date.getTime() + INDIA_OFFSET_MINUTES * MINUTE_MS).toISOString().slice(0, 10);
}

/** Today in India as `YYYY-MM-DD` (default ranges; the server refuses a `to` after today). */
export const indiaToday = (now: Date = new Date()): string => indiaDay(now) as string;

/** A `YYYY-MM-DD` date moved by whole days. */
export function addDays(day: string, days: number): string {
    const match = DATE_ONLY.exec(day);
    if (!match) return day;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
    return date.toISOString().slice(0, 10);
}

/** `YYYY-MM` of a day. */
export const monthOf = (day: string): string => day.slice(0, 7);

/** First and last day of a `YYYY-MM` month; the last day is cut to today for the running month. */
export function monthRange(month: string, today: string = indiaToday()): { from: string; to: string } | null {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return null;
    const year = Number(match[1]);
    const index = Number(match[2]);
    if (index < 1 || index > 12) return null;
    const from = `${match[1]}-${match[2]}-01`;
    const last = new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
    return { from, to: last > today ? today : last };
}

/** This month so far: the default range of most reports. */
export const thisMonthRange = (today: string = indiaToday()) => ({ from: `${monthOf(today)}-01`, to: today });

/** A date-only string as a Date at UTC midnight, for printing with `timeZone: 'UTC'`. */
function dateOnly(value: string): Date | null {
    const match = DATE_ONLY.exec(value);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/** An instant moved to India wall time, read back with `timeZone: 'UTC'`. */
const asIndiaWall = (date: Date) => new Date(date.getTime() + INDIA_OFFSET_MINUTES * MINUTE_MS);

/** India dates read day first in both languages ("1 Nov 2026", "1 नव॰ 2026"). */
export const reportLocale = (): string => (getActiveLocale().toLowerCase().startsWith('hi') ? 'hi-IN' : 'en-IN');

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' };

/** "1 Nov 2026" in the admin's language: a date-only value as it is, a timestamp as its India day. */
export function formatIndiaDate(value: unknown): string {
    const text = str(value);
    if (!text) return '—';
    const plain = dateOnly(text);
    const date = plain ?? (() => {
        const instant = readInstant(text);
        return instant ? asIndiaWall(instant) : null;
    })();
    if (!date) return text;
    return new Intl.DateTimeFormat(reportLocale(), DATE_OPTIONS).format(date);
}

/** "14:05" India time of a timestamp; "—" for a date-only event. */
export function formatIndiaTime(value: unknown): string {
    const instant = readInstant(value);
    if (!instant) return '—';
    return new Intl.DateTimeFormat(reportLocale(), TIME_OPTIONS).format(asIndiaWall(instant));
}

/** "1 Nov 2026, 14:05" India time. */
export function formatIndiaDateTime(value: unknown): string {
    const instant = readInstant(value);
    if (!instant) return formatIndiaDate(value);
    return `${formatIndiaDate(value)}, ${formatIndiaTime(value)}`;
}

/** A QTY cell: a number in display units (5.9), printed without unit (the `*_text` column carries it). */
export function formatQuantityCell(value: ReportCell): string {
    if (typeof value === 'string' && num(value) === null) return value.trim() || '—';
    const plain = num(value);
    return plain === null ? '—' : formatNumber(plain, { maximumFractionDigits: 3 });
}

const WALL_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/;

/**
 * A TIME cell: the server's India wall-clock text `yyyy-MM-dd HH:mm` printed
 * as "19 Nov 2026, 14:05" (the same date and clock, re-worded only). Anything
 * else ("—" for a date-only event) is printed exactly as sent.
 */
export function formatWallTime(value: ReportCell): string {
    const text = str(value);
    if (!text) return '—';
    const match = WALL_TIME.exec(text);
    if (!match) return text;
    return `${formatIndiaDate(match[1])}, ${match[2]}`;
}

/** A percentage the server computed (12.5 → "12.5%"). */
export function formatPercentCell(value: ReportCell): string {
    const plain = num(value);
    if (plain === null) return str(value) ?? '—';
    return `${formatNumber(plain, { maximumFractionDigits: 2 })}%`;
}

/** Text of any non-money cell by its column type (money goes through `MoneyCell`). */
export function cellText(type: ReportColumnType, value: ReportCell): string {
    if (value === null || value === undefined || value === '') return '';
    switch (type) {
        case 'DATE':
            return formatIndiaDate(value);
        case 'TIME':
            return formatWallTime(value);
        case 'QTY':
            return formatQuantityCell(value);
        case 'PERCENT':
            return formatPercentCell(value);
        case 'INT': {
            const plain = num(value);
            return plain === null ? String(value) : formatNumber(plain);
        }
        case 'MONEY': {
            const plain = num(value);
            return plain === null ? String(value) : formatMoney(plain);
        }
        default:
            if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
            if (typeof value === 'object') return str(asRecord(value)?.text) ?? '';
            return String(value);
    }
}

/** True when the server's figure is exactly zero ("0.00", 0, "-0.00"). Compares, never adds. */
export function isZeroFigure(value: ReportCell): boolean {
    const plain = num(value);
    return plain !== null && Math.abs(plain) < 0.005;
}
