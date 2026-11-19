/**
 * Answer shapes of the report endpoints (WP-50 contract §2, §6.1, §6.4).
 *
 * `GET /commerce/v1/reports/{name}` answers a `ReportAnswer`: the main table
 * (`columns`, `rows`, `totals`), named `sections` for reports with more than
 * one table (GSTR-1 sheets, day book documents and money, documents issued),
 * the GSTR-1 `check` block, `warnings`, `next_cursor` for registers and
 * `as_of` (when the read replica answered). Every money figure, every total
 * and every check comes from the server: the screens never add money.
 *
 * `reports-api.ts` normalises the wire into these shapes, so a screen never
 * meets `undefined` where a list is expected.
 */

/** Column types of `export/ReportTable.java` (contract §6.1) plus the two the screens print specially. */
export const REPORT_COLUMN_TYPES = [
    'TEXT',
    'MONEY',
    'QTY',
    'DATE',
    'TIME',
    'INT',
    'PERCENT',
    /** A rate per display unit ("₹123.40 / m"). */
    'RATE',
    /** A place of supply ("<code>-<state name>", or a bare state code). */
    'STATE',
] as const;
export type ReportColumnType = (typeof REPORT_COLUMN_TYPES)[number];

export interface ReportColumn {
    key: string;
    /** Label in the admin's language (the server's label table, en or hi); null when not sent. */
    label: string | null;
    labelEn: string | null;
    labelHi: string | null;
    type: ReportColumnType;
}

export type ReportCell = unknown;
export type ReportRow = Record<string, ReportCell>;

export interface ReportWarning {
    code: string;
    message: string;
    /** The document or row the warning is about (a number, an HSN), when it has one. */
    ref: string | null;
    /** How many rows it covers, when the server counts them for us. */
    count: number | null;
}

export interface ReportSection {
    key: string;
    /** The server's title for the block, if it sends one (the screen has its own words for known keys). */
    title: string | null;
    columns: ReportColumn[];
    rows: ReportRow[];
    totals: ReportRow | null;
}

/** One line of the GSTR-1 check (contract §2.5): sections total vs documents total. */
export interface ReportCheckLine {
    key: string;
    sections: ReportCell;
    documents: ReportCell;
    difference: ReportCell;
}

export interface ReportCheck {
    /** The overall difference as the server sent it (0.00 when the sections add up). */
    difference: ReportCell;
    lines: ReportCheckLine[];
}

export interface ReportAnswer {
    report: string;
    from: string | null;
    to: string | null;
    filters: Record<string, unknown>;
    columns: ReportColumn[];
    rows: ReportRow[];
    totals: ReportRow | null;
    sections: ReportSection[];
    check: ReportCheck | null;
    warnings: ReportWarning[];
    nextCursor: string | null;
    /** When the figures were read (ISO time). */
    asOf: string | null;
}

/** Filters a report page sends (contract §2 "Common to every report"). */
export interface ReportFilterValues {
    from?: string;
    to?: string;
    locationId?: string;
    channel?: string;
    sellerGstin?: string;
    /** `YYYY-MM` (GST pack). */
    month?: string;
    groupBy?: string;
    /** `YYYY-MM-DD` (COD outstanding). */
    asOf?: string;
}

export type ReportFormat = 'csv' | 'xlsx';

// ─── Audit log (contract §6.4) ───────────────────────────────────────────────

export interface AuditChange {
    key: string;
    old: unknown;
    new: unknown;
}

export interface AuditRow {
    id: string;
    /** ISO time of the change. */
    at: string | null;
    actorUserId: string | null;
    actorName: string | null;
    locationId: string | null;
    locationName: string | null;
    kind: string;
    referenceType: string | null;
    referenceId: string | null;
    /** The document number when the server could resolve it. */
    referenceLabel: string | null;
    changes: AuditChange[];
    reason: string | null;
}

export interface ApprovalRow {
    id: string;
    at: string | null;
    action: string;
    referenceLabel: string | null;
    requestedBy: string | null;
    approvedBy: string | null;
    amount: ReportCell;
    reason: string | null;
}

export interface KeysetPage<T> {
    rows: T[];
    nextCursor: string | null;
}

export interface AuditFilterValues {
    from?: string;
    to?: string;
    actorUserId?: string;
    locationId?: string;
    kind?: string;
    /** A document number (bill, credit note, order, return, transfer). */
    reference?: string;
}
