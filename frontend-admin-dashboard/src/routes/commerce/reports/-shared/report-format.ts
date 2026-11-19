import type { TFunction } from 'i18next';
import { formatMoney } from '@/components/design-system/money-cell';
import { formatNumber, getActiveLocale } from '@/lib/formatters';
import { asRecord, num, str } from '@/routes/commerce/-shared/commerce-api';
import { GST_STATE_CODES } from '@/routes/commerce/-shared/gstin';
import { formatRate, lengthNumber, unitSign, unitWord } from '@/routes/commerce/-shared/units';
import type { ReportCell, ReportColumnType } from './report-types';

/**
 * How report cells read on screen (contract §7.2 `report-format.ts`).
 *
 * Dates are India dates. A stored timestamp is UTC; India is UTC+05:30 all
 * year (no summer time), so the India day of `2026-10-31T18:30:00Z` is
 * 1 November. A date-only value (`2026-11-01`, the server's `document_date`)
 * is already an India date and is printed as it is, never shifted.
 *
 * Quantities print in display units with the unit sign ("2.5 m") through the
 * shared `units.ts`; rates per display unit read "₹123.40 / m". Money is drawn
 * only by `MoneyCell` (design system); this file never adds two amounts.
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

/**
 * A quantity cell. The server may send it already printed ("2.5 m"), as the
 * stored integer with its scale and unit (`{base, qty_scale, unit}`), or as a
 * plain number for counted goods. Base units are shown in display units, so
 * 25 at scale 10 in MTR reads "2.5 m" (metres in the admin's word with `t`).
 */
export function formatQuantityCell(value: ReportCell, t?: TFunction): string {
    if (typeof value === 'string') return value.trim() || '—';
    const record = asRecord(value);
    if (record) {
        const base = num(record.base ?? record.qty ?? record.quantity);
        if (base === null) return str(record.text) ?? '—';
        const scale = num(record.qty_scale ?? record.scale) ?? 1;
        const unit = str(record.unit);
        const number = lengthNumber(base, scale);
        const sign = t ? unitWord(unit, t) : unitSign(unit);
        return sign ? `${number} ${sign}` : number;
    }
    const plain = num(value);
    return plain === null ? '—' : formatNumber(plain);
}

/**
 * A rate per display unit. Printed by the server ("₹123.40 / m"), a per-base-unit
 * price with its scale (`{unit_price, qty_scale, unit}` → × scale in paise), or
 * an amount already per display unit (`{amount, unit}`).
 */
export function formatRateCell(value: ReportCell, t?: TFunction): string {
    if (typeof value === 'string' && num(value) === null) return value.trim() || '—';
    const record = asRecord(value);
    if (!record) {
        const plain = num(value);
        return plain === null ? '—' : formatMoney(plain);
    }
    const unit = str(record.unit);
    const basePrice = num(record.unit_price ?? record.price_per_base);
    if (basePrice !== null) return formatRate(basePrice, num(record.qty_scale ?? record.scale) ?? 1, unit, null, t);
    const amount = num(record.amount ?? record.rate);
    if (amount === null) return str(record.text) ?? '—';
    const sign = t ? unitWord(unit, t) : unitSign(unit);
    return sign ? `${formatMoney(amount)} / ${sign}` : formatMoney(amount);
}

const KNOWN_STATES = new Set(GST_STATE_CODES);

/**
 * Place of supply as the GST forms write it: "<code>-<state name>". The server
 * normally sends that text; a bare two-digit code gets the state's name from
 * the commerce `states.<code>` strings.
 */
export function placeOfSupplyText(value: ReportCell, t?: TFunction): string {
    const text = typeof value === 'number' ? String(value).padStart(2, '0') : (str(value) ?? '');
    if (!text) return '—';
    if (/^\d{1,2}$/.test(text)) {
        const code = text.padStart(2, '0');
        if (t && KNOWN_STATES.has(code)) return `${code}-${t(`states.${code}`)}`;
        return code;
    }
    return text;
}

/** A percentage the server computed (12.5 → "12.5%"). */
export function formatPercentCell(value: ReportCell): string {
    const plain = num(value);
    if (plain === null) return str(value) ?? '—';
    return `${formatNumber(plain, { maximumFractionDigits: 2 })}%`;
}

/** Text of any non-money cell by its column type (money goes through `MoneyCell`). */
export function cellText(type: ReportColumnType, value: ReportCell, t?: TFunction): string {
    if (value === null || value === undefined || value === '') return '';
    switch (type) {
        case 'DATE':
            return formatIndiaDate(value);
        case 'TIME':
            return readInstant(value) ? formatIndiaDateTime(value) : formatIndiaDate(value);
        case 'QTY':
            return formatQuantityCell(value, t);
        case 'RATE':
            return formatRateCell(value, t);
        case 'STATE':
            return placeOfSupplyText(value, t);
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
