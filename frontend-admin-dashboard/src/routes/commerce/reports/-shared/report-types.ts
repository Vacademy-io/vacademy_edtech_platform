/**
 * Answer shapes of the report endpoints (WP-50 contract §2, §6.1, §6.4).
 *
 * `GET /commerce/v1/reports/{name}` answers a `ReportAnswer`: the main table
 * (`columns`, `rows`, `totals`), named `sections` for reports with more than
 * one table (GSTR-1 sheets, day book documents and money, documents issued),
 * the GSTR-1 `check` block, `warnings`, `next_cursor` for registers and
 * `as_of` (when the read replica answered). Every money figure, every total
 * and every check comes from the server: the screens never add money. Shapes
 * follow `report/dto/ReportDtos.java` key for key.
 *
 * `reports-api.ts` normalises the wire into these shapes, so a screen never
 * meets `undefined` where a list is expected.
 */

/** Column types of `export/ReportTable.java` (`ReportTable.Type`), the only ones the server sends. */
export const REPORT_COLUMN_TYPES = ['TEXT', 'MONEY', 'QTY', 'DATE', 'TIME', 'INT', 'PERCENT'] as const;
export type ReportColumnType = (typeof REPORT_COLUMN_TYPES)[number];

/** A column as `ReportDtos.ColumnDto` sends it: `{key, label, label_hi, type}`. */
export interface ReportColumn {
    key: string;
    /** The server's English label (`label`). */
    labelEn: string | null;
    /** The server's Hindi label (`label_hi`). */
    labelHi: string | null;
    type: ReportColumnType;
}

export type ReportCell = unknown;
export type ReportRow = Record<string, ReportCell>;

/** `ReportDtos.Warning`: `{code, message, ref}`. */
export interface ReportWarning {
    code: string;
    message: string;
    /** The document or row the warning is about (a number, an HSN), when it has one. */
    ref: string | null;
    /**
     * The server lists at most 100 warnings per code and folds the rest into one
     * `{code, message: "and N more", ref: null}`: N here, null on a normal warning.
     */
    more: number | null;
}

/** `ReportDtos.Section`: `{key, label, label_hi, columns, rows, totals}`. */
export interface ReportSection {
    key: string;
    labelEn: string | null;
    labelHi: string | null;
    columns: ReportColumn[];
    rows: ReportRow[];
    totals: ReportRow | null;
}

/** One line of the GSTR-1 check (`Gstr1Builder.check`): sections total vs documents total for one column. */
export interface ReportCheckLine {
    /** A column key of the sheets (`taxable_value`, `cgst`, `sgst`, `igst`, `cess`). */
    key: string;
    sections: ReportCell;
    documents: ReportCell;
    difference: ReportCell;
}

/** `check` of an answer: `{rule, columns?: [...], difference, ...figures}`. */
export interface ReportCheck {
    /** The rule as the server words it (English; the screen shows its own words per report). */
    rule: string | null;
    /** The overall difference as the server sent it (0.00 when the sections add up). */
    difference: ReportCell;
    /** GSTR-1 only: one line per checked column (`check.columns`). */
    columns: ReportCheckLine[];
    /**
     * The flat figures of the other checks (sales register, credit notes, HSN summary, POS
     * sessions): every key but `rule`, `difference` and `columns`, in the server's order.
     */
    figures: [string, ReportCell][];
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
    /** When the figures were read (India ISO time with offset). */
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
    /** Sales register: `ACTIVE` or `CANCELLED` (absent = all bills). */
    status?: string;
    /** GSTR-1 / GST pack: the B2C large limit in rupees (absent = the server's default). */
    b2clLimit?: string;
}

/**
 * A place the caller may report on (`GET /reports/places`, R9): any report
 * reader can read it, without the stock feature.
 */
export interface ReportPlace {
    id: string;
    name: string;
    /** A short code when the server sends one. */
    code: string | null;
    gstin: string | null;
}

export interface ReportPlaces {
    places: ReportPlace[];
    /**
     * True when the caller is ADMIN or assigned to every active place: the GST
     * reports (which cover the whole GSTIN) are open to them. Null when the
     * server did not say.
     */
    allPlaces: boolean | null;
    /**
     * The server's own word that the GST reports will answer this caller
     * (`gst_reports`: every place and the tax reports feature on). Null or
     * absent when the server did not say; then `allPlaces` decides.
     */
    gstReports?: boolean | null;
}

/** Someone seen in the caller's audit scope (`GET /reports/audit/actors`, R9). */
export interface AuditActor {
    userId: string;
    name: string;
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
