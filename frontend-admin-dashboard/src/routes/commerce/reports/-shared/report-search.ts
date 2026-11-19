import { REPORT_CHANNELS, REPORT_IDS, REPORT_STATUSES, type ReportEntry, type ReportId } from './report-catalogue';
import { addDays, indiaToday, monthOf, monthRange, previousMonth, thisMonthRange } from './report-format';
import { GSTR1_TABS } from './report-keys';
import type { ReportFilterValues } from './report-types';

/**
 * The report page's address (contract §7.1): every filter lives in the search
 * params, so Back works and a link can be shared. Anything malformed is
 * dropped here and the page falls back to its default.
 */
export interface ReportsSearch {
    report?: ReportId;
    from?: string;
    to?: string;
    /** A location id; absent = "All my places". */
    location?: string;
    channel?: string;
    gstin?: string;
    /** `YYYY-MM`. */
    month?: string;
    groupBy?: string;
    /** `YYYY-MM-DD`. */
    asOf?: string;
    /** Sales register: `ACTIVE` or `CANCELLED`. */
    status?: string;
    /** GSTR-1 / GST pack: B2C large limit in rupees, as typed. */
    b2clLimit?: string;
    /** GSTR-1: the sheet on screen (N6: a shared link opens on it). */
    tab?: string;
}

export interface AuditSearch {
    tab?: 'changes' | 'approvals';
    from?: string;
    to?: string;
    actor?: string;
    location?: string;
    kind?: string;
    /** A document number. */
    reference?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const text = (value: unknown, max = 64): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined;
const day = (value: unknown): string | undefined => {
    const v = text(value, 10);
    return v && DAY.test(v) ? v : undefined;
};

export function validateReportsSearch(search: Record<string, unknown>): ReportsSearch {
    const report = text(search.report, 32);
    const channel = text(search.channel, 16)?.toUpperCase();
    const gstin = text(search.gstin, 15)?.toUpperCase();
    const month = text(search.month, 7);
    return {
        report: report && (REPORT_IDS as readonly string[]).includes(report) ? (report as ReportId) : undefined,
        from: day(search.from),
        to: day(search.to),
        location: text(search.location),
        channel: channel && (REPORT_CHANNELS as readonly string[]).includes(channel) ? channel : undefined,
        gstin: gstin && /^[0-9A-Z]{15}$/.test(gstin) ? gstin : undefined,
        month: month && MONTH.test(month) ? month : undefined,
        groupBy: text(search.groupBy, 32),
        asOf: day(search.asOf),
        status: oneOf(search.status, REPORT_STATUSES),
        b2clLimit: text(typeof search.b2clLimit === 'number' ? String(search.b2clLimit) : search.b2clLimit, 16),
        tab: oneOf(search.tab, GSTR1_TABS, false),
    };
}

function oneOf(value: unknown, allowed: readonly string[], upper = true): string | undefined {
    const v = text(value, 32);
    const normal = upper ? v?.toUpperCase() : v;
    return normal && allowed.includes(normal) ? normal : undefined;
}

export function validateAuditSearch(search: Record<string, unknown>): AuditSearch {
    const tab = text(search.tab, 16);
    return {
        tab: tab === 'approvals' || tab === 'changes' ? tab : undefined,
        from: day(search.from),
        to: day(search.to),
        actor: text(search.actor),
        location: text(search.location),
        kind: text(search.kind, 32),
        reference: text(search.reference, 64),
    };
}

/**
 * The GST month a page shows: the address's, else the month gone by (M1:
 * GSTR-1 is filed for the previous month, by the 11th; the running month
 * would give a part month that looks like a whole one).
 */
export const resolvedMonth = (search: Pick<ReportsSearch, 'month'>, today: string = indiaToday()): string =>
    search.month ?? previousMonth(today);

/** Lowest and highest B2C large limit the server takes (R5), in rupees, at most 2 decimals. */
export const B2CL_LIMIT_MIN = 1;
export const B2CL_LIMIT_MAX = 10_000_000;

/** The typed B2C large limit is a plain rupee amount within the server's bounds. */
export function b2clLimitOk(value: string): boolean {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return false;
    const amount = Number(value);
    return amount >= B2CL_LIMIT_MIN && amount <= B2CL_LIMIT_MAX;
}

/** How far back a report may go (R5): three years before today. */
export const MAX_YEARS_BACK = 3;

export function oldestDay(today: string = indiaToday()): string {
    return `${Number(today.slice(0, 4)) - MAX_YEARS_BACK}${today.slice(4)}`;
}

/**
 * The filters a report page sends: what the address says, else the report's
 * default (this month; day book today; GST month the month gone by; COD
 * outstanding as of today). Only the filters the report takes are sent.
 */
export function resolveReportFilters(
    entry: ReportEntry,
    search: ReportsSearch,
    today: string = indiaToday()
): ReportFilterValues {
    const has = (key: string) => (entry.filters as readonly string[]).includes(key);
    const out: ReportFilterValues = {};
    if (has('range')) {
        const fallback = entry.defaultRange === 'today' ? { from: today, to: today } : thisMonthRange(today);
        out.from = search.from ?? fallback.from;
        out.to = search.to ?? fallback.to;
    }
    if (has('month')) {
        const month = resolvedMonth(search, today);
        if (entry.id === 'gstPack') {
            out.month = month;
        } else {
            const range = monthRange(month, today);
            out.from = range?.from;
            out.to = range?.to;
        }
    }
    if (has('location') && search.location) out.locationId = search.location;
    if (has('channel') && search.channel) out.channel = search.channel;
    if (has('gstin') && search.gstin) out.sellerGstin = search.gstin;
    if (has('groupBy') && entry.groupBy) {
        out.groupBy = search.groupBy && entry.groupBy.includes(search.groupBy) ? search.groupBy : entry.groupBy[0];
    }
    if (has('asOf')) out.asOf = search.asOf ?? today;
    if (has('status') && search.status) out.status = search.status;
    if (has('b2clLimit') && search.b2clLimit) out.b2clLimit = search.b2clLimit;
    return out;
}

export type RangeProblem = 'order' | 'tooLong' | 'future' | 'futureMonth' | 'tooOld' | 'b2clLimit';

/** Every problem a filter can have, for the locales test. */
export const RANGE_PROBLEMS: readonly RangeProblem[] = ['order', 'tooLong', 'future', 'futureMonth', 'tooOld', 'b2clLimit'];

/** The range rules of contract §3.1, checked before asking (the server refuses the same). */
export function rangeProblem(
    entry: ReportEntry,
    filters: ReportFilterValues,
    today: string = indiaToday()
): RangeProblem | null {
    if (filters.b2clLimit !== undefined && !b2clLimitOk(filters.b2clLimit)) return 'b2clLimit';
    if (filters.month && filters.month > monthOf(today)) return 'futureMonth';
    if (filters.month && `${filters.month}-01` < `${oldestDay(today).slice(0, 7)}-01`) return 'tooOld';
    if (filters.asOf && filters.asOf > today) return 'future';
    if (filters.asOf && filters.asOf < oldestDay(today)) return 'tooOld';
    const { from, to } = filters;
    if (!from || !to) return null;
    if (from > to) return 'order';
    if (to > today) return 'future';
    if (from < oldestDay(today)) return 'tooOld';
    if (addDays(from, entry.maxDays - 1) < to) return 'tooLong';
    return null;
}
