import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { saveBlob } from '@/lib/save-blob';
import { asRecord, instituteParams, num, str } from '@/routes/commerce/-shared/commerce-api';
import { COMMERCE_BASE } from '@/routes/commerce/-shared/commerce-urls';

/**
 * Parallel-run services (WP-53, `ParallelRunController`): the day list with the
 * clean-day streak, saving one day's old-system totals, and the export. Answers
 * are normalised here (snake_case in, camelCase out); nothing here adds money:
 * every difference, verdict and streak is the server's.
 */

export const PARALLEL_RUN_BASE = `${COMMERCE_BASE}/parallel-run`;
export const PARALLEL_RUN_DAYS = `${PARALLEL_RUN_BASE}/days`;
export const PARALLEL_RUN_DAY = (date: string) => `${PARALLEL_RUN_DAYS}/${encodeURIComponent(date)}`;
export const PARALLEL_RUN_EXPORT = `${PARALLEL_RUN_BASE}/export`;

/** CLEAN / DIFFERENT (saved), RECHECK (platform changed since), NOT_SAVED (trading day), NO_SALES. */
export type DayStatus = 'CLEAN' | 'DIFFERENT' | 'RECHECK' | 'NOT_SAVED' | 'NO_SALES';
const STATUSES: readonly DayStatus[] = ['CLEAN', 'DIFFERENT', 'RECHECK', 'NOT_SAVED', 'NO_SALES'];

/** Money stays the server's text ("800.00") so nothing is rounded on the way. */
type Money = string;

export interface PlatformFigures {
    bills: number;
    salesValue: Money;
    tax: Money;
    cash: Money;
    returns: Money;
    openSessions: number;
}

export interface OldFigures {
    billCount: number;
    salesValue: Money;
    tax: Money;
    cash: Money;
    returns: Money | null;
}

export interface Differences {
    bills: number;
    salesValue: Money;
    tax: Money;
    cash: Money;
    returns: Money | null;
}

export interface ParallelRunDay {
    date: string;
    status: DayStatus;
    platform: PlatformFigures;
    old: OldFigures | null;
    difference: Differences | null;
    result: 'CLEAN' | 'DIFFERENT' | null;
    platformChanged: boolean;
    countsClean: boolean;
    note: string | null;
    reviewedBy: string | null;
    reviewedByName: string | null;
    reviewedAt: string | null;
    version: number | null;
}

export interface ParallelRunDays {
    locationId: string;
    from: string;
    to: string;
    today: string;
    days: ParallelRunDay[];
    streak: number;
    passed: boolean;
    cleanDaysNeeded: number;
    latestSaved: string | null;
    tolerance: Money;
    asOf: string | null;
}

export interface SaveDayInput {
    oldBillCount: number;
    oldSalesValue: string;
    oldTax: string;
    oldCash: string;
    oldReturns?: string | null;
    note?: string | null;
    version?: number | null;
}

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => asRecord(value) ?? {};
const money = (value: unknown): Money => {
    if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
    return str(value) ?? '0.00';
};
const moneyOrNull = (value: unknown): Money | null => (value === null || value === undefined ? null : money(value));
const int = (value: unknown): number => num(value) ?? 0;

function normalizePlatform(raw: unknown): PlatformFigures {
    const r = rec(raw);
    return {
        bills: int(r.bills),
        salesValue: money(r.sales_value),
        tax: money(r.tax),
        cash: money(r.cash),
        returns: money(r.returns),
        openSessions: int(r.open_sessions),
    };
}

export function normalizeDay(raw: unknown): ParallelRunDay | null {
    const r = asRecord(raw);
    const date = str(r?.date);
    if (!r || !date) return null;
    const status = STATUSES.includes(r.status as DayStatus) ? (r.status as DayStatus) : 'NOT_SAVED';
    const oldRaw = asRecord(r.old);
    const diffRaw = asRecord(r.difference);
    const result = r.result === 'CLEAN' || r.result === 'DIFFERENT' ? r.result : null;
    return {
        date,
        status,
        platform: normalizePlatform(r.platform),
        old: oldRaw
            ? {
                  billCount: int(oldRaw.bill_count),
                  salesValue: money(oldRaw.sales_value),
                  tax: money(oldRaw.tax),
                  cash: money(oldRaw.cash),
                  returns: moneyOrNull(oldRaw.returns),
              }
            : null,
        difference: diffRaw
            ? {
                  bills: int(diffRaw.bills),
                  salesValue: money(diffRaw.sales_value),
                  tax: money(diffRaw.tax),
                  cash: money(diffRaw.cash),
                  returns: moneyOrNull(diffRaw.returns),
              }
            : null,
        result,
        platformChanged: r.platform_changed === true,
        countsClean: r.counts_clean === true,
        note: str(r.note),
        reviewedBy: str(r.reviewed_by),
        reviewedByName: str(r.reviewed_by_name),
        reviewedAt: str(r.reviewed_at),
        version: num(r.version),
    };
}

export function normalizeDays(raw: unknown): ParallelRunDays {
    const r = rec(raw);
    return {
        locationId: str(r.location_id) ?? '',
        from: str(r.from) ?? '',
        to: str(r.to) ?? '',
        today: str(r.today) ?? '',
        days: (Array.isArray(r.days) ? r.days : []).map(normalizeDay).filter((d): d is ParallelRunDay => !!d),
        streak: int(r.streak),
        passed: r.passed === true,
        cleanDaysNeeded: num(r.clean_days_needed) ?? 7,
        latestSaved: str(r.latest_saved),
        tolerance: money(r.tolerance ?? '1.00'),
        asOf: str(r.as_of),
    };
}

export async function fetchParallelRunDays(locationId: string, from: string, to: string): Promise<ParallelRunDays> {
    const res = await authenticatedAxiosInstance.get<unknown>(PARALLEL_RUN_DAYS, {
        params: { ...instituteParams(), locationId, from, to },
    });
    return normalizeDays(res.data);
}

/** The PUT body in the server's names; an empty returns box means "not compared". */
export function saveDayBody(input: SaveDayInput): Rec {
    const body: Rec = {
        old_bill_count: input.oldBillCount,
        old_sales_value: input.oldSalesValue,
        old_tax: input.oldTax,
        old_cash: input.oldCash,
    };
    if (input.oldReturns !== undefined && input.oldReturns !== null && input.oldReturns !== '') {
        body.old_returns = input.oldReturns;
    }
    if (input.note && input.note.trim() !== '') body.note = input.note.trim();
    if (input.version !== undefined && input.version !== null) body.version = input.version;
    return body;
}

export async function saveParallelRunDay(locationId: string, date: string, input: SaveDayInput): Promise<ParallelRunDay> {
    const res = await authenticatedAxiosInstance.put<unknown>(PARALLEL_RUN_DAY(date), saveDayBody(input), {
        params: { ...instituteParams(), locationId },
    });
    const day = normalizeDay(res.data);
    if (!day) throw new Error('The server answered without the day');
    return day;
}

export async function downloadParallelRun(
    locationId: string,
    from: string,
    to: string,
    format: 'csv' | 'xlsx'
): Promise<string> {
    const res = await authenticatedAxiosInstance.get<Blob>(PARALLEL_RUN_EXPORT, {
        params: { ...instituteParams(), locationId, from, to, format },
        responseType: 'blob',
    });
    const disposition = String((res.headers as Record<string, unknown>)?.['content-disposition'] ?? '');
    const named = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    const fileName = named ?? `parallel-run-${from}-${to}.${format}`;
    await saveBlob(res.data, fileName);
    return fileName;
}
