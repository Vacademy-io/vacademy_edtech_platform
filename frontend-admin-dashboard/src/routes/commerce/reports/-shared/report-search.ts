import { REPORT_CHANNELS, REPORT_IDS, type ReportEntry, type ReportId } from './report-catalogue';
import { addDays, indiaToday, monthOf, monthRange, thisMonthRange } from './report-format';
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
    };
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
 * The filters a report page sends: what the address says, else the report's
 * default (this month; day book today; COD outstanding as of today). Only the
 * filters the report takes are sent.
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
        const month = search.month ?? monthOf(today);
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
    return out;
}

export type RangeProblem = 'order' | 'tooLong' | 'future' | 'futureMonth';

/** The range rules of contract §3.1, checked before asking (the server refuses the same). */
export function rangeProblem(
    entry: ReportEntry,
    filters: ReportFilterValues,
    today: string = indiaToday()
): RangeProblem | null {
    if (filters.month && filters.month > monthOf(today)) return 'futureMonth';
    if (filters.asOf && filters.asOf > today) return 'future';
    const { from, to } = filters;
    if (!from || !to) return null;
    if (from > to) return 'order';
    if (to > today) return 'future';
    if (addDays(from, entry.maxDays - 1) < to) return 'tooLong';
    return null;
}
