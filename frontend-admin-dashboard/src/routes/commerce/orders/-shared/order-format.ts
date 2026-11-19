import type { TFunction } from 'i18next';
import { formatNumber } from '@/lib/formatters';
import { lengthNumber, unitWord } from '@/routes/commerce/-shared/units';
import type { StaffOrderRow } from './order-types';

/**
 * Small display rules of the order desk: quantities (the wire holds the stored
 * integer; `qty_scale` 10 means tenths of a metre), the "in this status for"
 * age and the late marker.
 */

/** Owner default (Q4): an order waiting this long to be packed or shipped is late. */
export const LATE_AFTER_HOURS = 48;
/** COD orders waiting for the phone call are late sooner (the server cancels at 48 h). */
export const LATE_TO_CONFIRM_AFTER_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** The stored integer as the amount people read: 25 at scale 10 → 2.5. */
export const displayQuantity = (qty: number, qtyScale: number | null | undefined): number => {
    const scale = qtyScale && qtyScale > 1 ? qtyScale : 1;
    return qty / scale;
};

/**
 * Back from a number (2.5 m) to the stored integer (25). Only for numbers the
 * screen made itself; typed text goes through `parseLength`, which refuses
 * extra decimals instead of rounding them away.
 */
export const storedQuantity = (typed: number, qtyScale: number | null | undefined): number => {
    const scale = qtyScale && qtyScale > 1 ? qtyScale : 1;
    return Math.round(typed * scale);
};

/**
 * A quantity for the screen. Measured goods (scale > 1) print at most one
 * decimal per power of ten, trailing zeros dropped, and their unit ("2.5 m",
 * "3 m"; metres in the admin's word); counted goods are whole numbers.
 */
export function formatQuantity(
    qty: number,
    qtyScale: number | null | undefined,
    unit: string | null | undefined,
    t: TFunction
): string {
    const scale = qtyScale && qtyScale > 1 ? qtyScale : 1;
    if (scale === 1) return formatNumber(qty);
    const word = unitWord(unit, t);
    const value = lengthNumber(qty, scale);
    return word ? `${value} ${word}` : value;
}

export function ageSince(iso: string | null | undefined, now: number): { days: number; hours: number } | null {
    if (!iso) return null;
    const since = Date.parse(iso);
    if (!Number.isFinite(since)) return null;
    const hoursTotal = Math.max(0, Math.floor((now - since) / HOUR_MS));
    return { days: Math.floor(hoursTotal / 24), hours: hoursTotal % 24 };
}

export function isLate(
    row: Pick<StaffOrderRow, 'status' | 'status_since'>,
    now: number
): boolean {
    if (!row.status_since) return false;
    const since = Date.parse(row.status_since);
    if (!Number.isFinite(since)) return false;
    const hours = (now - since) / HOUR_MS;
    if (row.status === 'CONFIRMED' || row.status === 'PACKED') return hours > LATE_AFTER_HOURS;
    if (row.status === 'COD_PENDING_CONFIRMATION') return hours > LATE_TO_CONFIRM_AFTER_HOURS;
    return false;
}

export function formatAge(age: { days: number; hours: number } | null, t: TFunction): string {
    if (!age) return '—';
    if (age.days === 0) return t('orders.age.hours', { hours: age.hours });
    return t('orders.age.daysHours', { days: age.days, hours: age.hours });
}

/** "Cash on delivery", "Prepaid"… with the raw value for anything new. */
export function paymentLabel(row: Pick<StaffOrderRow, 'payment_method'>, t: TFunction): string {
    const method = (row.payment_method ?? '').toUpperCase();
    if (method === 'PREPAID' || method === 'COD' || method === 'OFFLINE') {
        return t(`orders.paymentMethod.${method}`);
    }
    return method || '—';
}

export function channelLabel(channel: string | null | undefined, t: TFunction): string {
    const value = (channel ?? '').toUpperCase();
    if (value === 'ONLINE' || value === 'ADMIN' || value === 'POS') return t(`orders.channel.${value}`);
    return value || '—';
}

/** The amount the courier hands over for a COD order (B1 field, else what is unpaid). */
export function codToCollect(row: Pick<StaffOrderRow, 'cod_amount' | 'total' | 'amount_paid'>): number {
    if (typeof row.cod_amount === 'number') return row.cod_amount;
    return Math.max(0, round2(row.total - row.amount_paid));
}

export const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Today in the browser's own calendar, as `YYYY-MM-DD` (date inputs and request bodies). */
export function todayIso(now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
