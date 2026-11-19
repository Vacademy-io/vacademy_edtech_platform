import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { saveBlob } from '@/lib/save-blob';
import { asRecord, instituteParams, num, str } from '@/routes/commerce/-shared/commerce-api';
import {
    COMMERCE_AUDIT,
    COMMERCE_AUDIT_APPROVALS,
    COMMERCE_AUDIT_KINDS,
    COMMERCE_REPORT,
} from '@/routes/commerce/-shared/commerce-urls';
import {
    type ApprovalRow,
    type AuditChange,
    type AuditFilterValues,
    type AuditRow,
    type KeysetPage,
    REPORT_COLUMN_TYPES,
    type ReportAnswer,
    type ReportCheck,
    type ReportCheckLine,
    type ReportColumn,
    type ReportColumnType,
    type ReportFilterValues,
    type ReportFormat,
    type ReportRow,
    type ReportSection,
    type ReportWarning,
} from './report-types';

/**
 * Report and audit services (WP-50 contract §2, §6.1, §6.4): one function per
 * endpoint, no React. Answers are normalised here, so a screen never meets
 * `undefined` where a list is expected. Every call carries the institute; the
 * server checks feature, role and location (`CommerceAccessGuard`).
 *
 * Nothing here adds money: totals and checks are the server's.
 */

type Rec = Record<string, unknown>;

/** Registers page by keyset: the server's default and largest page (contract §3.6). */
export const REPORT_PAGE_SIZE = 100;
export const AUDIT_PAGE_SIZE = 50;

const rec = (value: unknown): Rec => asRecord(value) ?? {};
const records = (value: unknown): Rec[] =>
    (Array.isArray(value) ? value : []).map(asRecord).filter((r): r is Rec => !!r);
const text = (value: unknown): string | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return str(value);
};

/** Query parameters without empty values (the server reads "" as a filter). */
function clean(params: Rec): Rec {
    return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** The filters as the server names them (contract §2: `locationId`, `sellerGstin`…). */
export function reportParams(filters: ReportFilterValues): Rec {
    return clean({
        from: filters.from,
        to: filters.to,
        locationId: filters.locationId,
        channel: filters.channel,
        sellerGstin: filters.sellerGstin,
        month: filters.month,
        groupBy: filters.groupBy,
        asOf: filters.asOf,
    });
}

// ─── Answer normalisers ──────────────────────────────────────────────────────
// Read the keys of `report/dto/ReportDtos.java` exactly (snake_case); nothing else.

const COLUMN_TYPES = new Set<string>(REPORT_COLUMN_TYPES);

/** `{key, label, label_hi, type}` → a column; an unknown type prints as text. */
export function normalizeColumn(raw: unknown): ReportColumn | null {
    const r = asRecord(raw);
    const key = str(r?.key);
    if (!r || !key) return null;
    const type = str(r.type) ?? 'TEXT';
    return {
        key,
        labelEn: str(r.label),
        labelHi: str(r.label_hi),
        type: (COLUMN_TYPES.has(type) ? type : 'TEXT') as ReportColumnType,
    };
}

const columnsOf = (value: unknown): ReportColumn[] =>
    (Array.isArray(value) ? value : []).map(normalizeColumn).filter((c): c is ReportColumn => !!c);

/** Rows are maps keyed by column key. */
const rowsOf = (value: unknown): ReportRow[] => records(value);

/** Totals: a map; an empty map (the server never sends null) means none. */
function totalsOf(value: unknown): ReportRow | null {
    const r = asRecord(value);
    return r && Object.keys(r).length > 0 ? r : null;
}

/** `[{key, label, label_hi, columns, rows, totals}]`. */
function sectionsOf(value: unknown): ReportSection[] {
    return records(value).flatMap((r): ReportSection[] => {
        const key = str(r.key);
        if (!key) return [];
        return [
            {
                key,
                labelEn: str(r.label),
                labelHi: str(r.label_hi),
                columns: columnsOf(r.columns),
                rows: rowsOf(r.rows),
                totals: totalsOf(r.totals),
            },
        ];
    });
}

/** `{rule, difference, columns?: [{key, sections, documents, difference}]}` (GSTR-1 sends `columns`). */
function checkOf(value: unknown): ReportCheck | null {
    const r = asRecord(value);
    if (!r) return null;
    const columns = records(r.columns).flatMap((l): ReportCheckLine[] => {
        const key = str(l.key);
        return key
            ? [{ key, sections: l.sections ?? null, documents: l.documents ?? null, difference: l.difference ?? null }]
            : [];
    });
    return { rule: str(r.rule), difference: r.difference ?? null, columns };
}

/** The server's fold of the warnings beyond 100 per code: "and N more" with no ref. */
const FOLDED = /^and (\d+) more$/;

function warningsOf(value: unknown): ReportWarning[] {
    return records(value).flatMap((r): ReportWarning[] => {
        const code = str(r.code);
        if (!code) return [];
        const message = str(r.message) ?? '';
        const ref = text(r.ref);
        const folded = ref === null ? FOLDED.exec(message) : null;
        return [{ code, message, ref, more: folded ? Number(folded[1]) : null }];
    });
}

export function normalizeReport(data: unknown, fallbackName = ''): ReportAnswer {
    const r = rec(data);
    return {
        report: str(r.report) ?? fallbackName,
        from: str(r.from),
        to: str(r.to),
        filters: rec(r.filters),
        columns: columnsOf(r.columns),
        rows: rowsOf(r.rows),
        totals: totalsOf(r.totals),
        sections: sectionsOf(r.sections),
        check: checkOf(r.check),
        warnings: warningsOf(r.warnings),
        nextCursor: text(r.next_cursor),
        asOf: str(r.as_of),
    };
}

// ─── Reports ─────────────────────────────────────────────────────────────────

/** One page of a report: registers send `size` and, after the first page, `cursor`; summaries neither. */
export async function fetchReport(
    name: string,
    filters: ReportFilterValues,
    cursor?: string | null,
    size?: number
): Promise<ReportAnswer> {
    const params = {
        ...instituteParams(),
        ...reportParams(filters),
        ...clean({ cursor: cursor ?? undefined, size }),
        format: 'json',
    };
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_REPORT(name), { params });
    return normalizeReport(res.data, name);
}

/**
 * A file answer. When the server refuses, axios hands the error body over as a
 * Blob; it is read back into JSON so the refusal's code (`REPORT_BUSY: …`)
 * reaches the screen like any other error.
 */
async function fileRequest(run: () => Promise<{ data: Blob; headers?: unknown }>) {
    try {
        return await run();
    } catch (error) {
        const response = (error as { response?: { data?: unknown } })?.response;
        if (response && typeof Blob !== 'undefined' && response.data instanceof Blob) {
            try {
                response.data = JSON.parse(await response.data.text()) as unknown;
            } catch {
                // Not JSON: the status alone tells the screen what happened.
            }
        }
        throw error;
    }
}

/** `attachment; filename="sales-register-2026-11-01-2026-11-19.csv"` → the name (ASCII only, contract §3.7). */
export function fileNameFrom(headers: unknown, fallback: string): string {
    const h = rec(headers);
    const disposition = str(h['content-disposition']) ?? str(h['Content-Disposition']);
    const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null;
    const name = match?.[1]?.trim();
    return name && /^[\w.\- ]+$/.test(name) ? name : fallback;
}

/** The name a file gets when the server sends none: `<report>-<from>-<to>.<ext>` or `<report>-<month>.xlsx`. */
export function defaultFileName(name: string, filters: ReportFilterValues, format: ReportFormat): string {
    const span = filters.from && filters.to ? `${filters.from}-${filters.to}` : (filters.month ?? filters.asOf ?? '');
    return `${name}${span ? `-${span}` : ''}.${format}`;
}

/** Download a report as CSV or Excel and hand it to the browser (or the app's share sheet). */
export async function downloadReport(name: string, filters: ReportFilterValues, format: ReportFormat): Promise<string> {
    const res = await fileRequest(() =>
        authenticatedAxiosInstance.get<Blob>(COMMERCE_REPORT(name), {
            params: { ...instituteParams(), ...reportParams(filters), format },
            responseType: 'blob',
        })
    );
    const fileName = fileNameFrom(res.headers, defaultFileName(name, filters, format));
    await saveBlob(res.data, fileName);
    return fileName;
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export function auditParams(filters: AuditFilterValues): Rec {
    return clean({
        from: filters.from,
        to: filters.to,
        actorUserId: filters.actorUserId,
        locationId: filters.locationId,
        kind: filters.kind,
        reference: filters.reference?.trim(),
    });
}

function changesOf(value: unknown): AuditChange[] {
    return records(value).flatMap((r) => {
        const key = str(r.key) ?? str(r.field);
        return key ? [{ key, old: r.old ?? r.old_value ?? null, new: r.new ?? r.new_value ?? null }] : [];
    });
}

export function normalizeAuditRow(raw: unknown): AuditRow | null {
    const r = asRecord(raw);
    const id = text(r?.id);
    if (!r || !id) return null;
    return {
        id,
        at: str(r.created_at) ?? str(r.at) ?? str(r.when),
        actorUserId: str(r.actor_user_id),
        actorName: str(r.actor_name) ?? str(r.who),
        locationId: str(r.location_id),
        locationName: str(r.location_name) ?? str(r.location),
        kind: str(r.kind) ?? '',
        referenceType: str(r.reference_type),
        referenceId: text(r.reference_id),
        referenceLabel: text(r.reference_label),
        changes: changesOf(r.changes),
        reason: str(r.reason),
    };
}

export function normalizeApprovalRow(raw: unknown): ApprovalRow | null {
    const r = asRecord(raw);
    const id = text(r?.id);
    if (!r || !id) return null;
    return {
        id,
        at: str(r.created_at) ?? str(r.at) ?? str(r.when),
        action: str(r.action) ?? '',
        referenceLabel: text(r.reference_label),
        requestedBy: str(r.requested_by_name) ?? str(r.requested_by),
        approvedBy: str(r.approved_by_name) ?? str(r.approved_by),
        amount: r.amount ?? null,
        reason: str(r.reason),
    };
}

function keyset<T>(data: unknown, read: (raw: unknown) => T | null): KeysetPage<T> {
    const r = rec(data);
    const list = Array.isArray(data) ? data : Array.isArray(r.rows) ? r.rows : r.content;
    return {
        rows: (Array.isArray(list) ? list : []).map(read).filter((row): row is T => row !== null),
        nextCursor: text(r.next_cursor),
    };
}

export async function fetchAudit(filters: AuditFilterValues, cursor?: string | null): Promise<KeysetPage<AuditRow>> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_AUDIT, {
        params: {
            ...instituteParams(),
            ...auditParams(filters),
            ...clean({ cursor: cursor ?? undefined }),
            size: AUDIT_PAGE_SIZE,
        },
    });
    return keyset(res.data, normalizeAuditRow);
}

export async function fetchApprovals(
    filters: AuditFilterValues,
    cursor?: string | null
): Promise<KeysetPage<ApprovalRow>> {
    // The approvals table has no location (contract §6.4): only dates and the document number go.
    const { from, to, reference } = filters;
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_AUDIT_APPROVALS, {
        params: {
            ...instituteParams(),
            ...auditParams({ from, to, reference }),
            ...clean({ cursor: cursor ?? undefined }),
            size: AUDIT_PAGE_SIZE,
        },
    });
    return keyset(res.data, normalizeApprovalRow);
}

export async function fetchAuditKinds(): Promise<string[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_AUDIT_KINDS, { params: instituteParams() });
    const data = res.data;
    const list = Array.isArray(data) ? data : rec(data).kinds;
    return (Array.isArray(list) ? list : []).filter((k): k is string => typeof k === 'string' && k.length > 0).sort();
}

/** The audit list as CSV (audited by the server like a report export). */
export async function downloadAudit(filters: AuditFilterValues): Promise<string> {
    const res = await fileRequest(() =>
        authenticatedAxiosInstance.get<Blob>(COMMERCE_AUDIT, {
            params: { ...instituteParams(), ...auditParams(filters), format: 'csv' },
            responseType: 'blob',
        })
    );
    const span = filters.from && filters.to ? `-${filters.from}-${filters.to}` : '';
    const fileName = fileNameFrom(res.headers, `audit${span}.csv`);
    await saveBlob(res.data, fileName);
    return fileName;
}
