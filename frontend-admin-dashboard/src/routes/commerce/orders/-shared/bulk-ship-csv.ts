import Papa from 'papaparse';

/**
 * "Mark shipped" for many orders from a courier's CSV. Header
 * `order_number,courier,tracking_number,tracking_link` (any case, any order).
 * Only the ticked orders can be filled; every problem names its CSV line.
 */
export const BULK_SHIP_CSV_HEADER = ['order_number', 'courier', 'tracking_number', 'tracking_link'] as const;

export const BULK_SHIP_CSV_ERRORS = [
    'notSelected',
    'duplicate',
    'missingField',
    'noHeader',
    'empty',
    'unreadable',
    'tooLarge',
] as const;

/** A courier file for at most a page of orders is a few kB; anything over 1 MB is refused unread. */
export const BULK_SHIP_CSV_MAX_BYTES = 1_000_000;

/** How many problems the dialog lists; the rest are one "+N more" line. */
export const BULK_SHIP_CSV_SHOWN_PROBLEMS = 20;
export type BulkShipCsvError = (typeof BULK_SHIP_CSV_ERRORS)[number];

export interface BulkShipRowInput {
    order_id: string;
    order_number: string;
}

export interface BulkShipFill {
    order_id: string;
    carrier_name: string;
    tracking_number: string;
    tracking_url?: string;
}

export interface BulkShipCsvResult {
    items: BulkShipFill[];
    errors: { line: number; key: BulkShipCsvError; value?: string }[];
}

const norm = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function parseBulkShipCsv(text: string, rows: readonly BulkShipRowInput[]): BulkShipCsvResult {
    const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
    });
    const fields = parsed.meta.fields ?? [];
    // Broken quoting or a row with the wrong number of columns ("Delimiter" only means one column).
    // Papa counts a quote error's row from the header line and a column error's from the first data row.
    const brokenLines = parsed.errors
        .filter((problem) => problem.type !== 'Delimiter')
        .map((problem) => (problem.row ?? 0) + (problem.type === 'Quotes' ? 1 : 2));
    const unreadable =
        brokenLines.length > 0 ? { line: Math.min(...brokenLines), key: 'unreadable' as const } : null;
    if (!fields.includes('order_number')) {
        return { items: [], errors: unreadable ? [unreadable] : [{ line: 1, key: 'noHeader' }] };
    }
    if (parsed.data.length === 0) return { items: [], errors: [{ line: 1, key: 'empty' }] };

    const byNumber = new Map(rows.map((row) => [row.order_number.toUpperCase(), row]));
    const seen = new Set<string>();
    const items: BulkShipFill[] = [];
    const errors: BulkShipCsvResult['errors'] = [];

    parsed.data.forEach((record, index) => {
        const line = index + 2; // line 1 is the header
        const number = norm(record.order_number);
        const row = byNumber.get(number.toUpperCase());
        if (!row) {
            errors.push({ line, key: 'notSelected', value: number });
            return;
        }
        if (seen.has(row.order_id)) {
            errors.push({ line, key: 'duplicate', value: number });
            return;
        }
        const carrier = norm(record.courier);
        const tracking = norm(record.tracking_number);
        if (!carrier || !tracking) {
            errors.push({ line, key: 'missingField', value: number });
            return;
        }
        seen.add(row.order_id);
        const link = norm(record.tracking_link);
        items.push({
            order_id: row.order_id,
            carrier_name: carrier.slice(0, 100),
            tracking_number: tracking.slice(0, 64),
            ...(link ? { tracking_url: link.slice(0, 500) } : {}),
        });
    });
    // Nothing usable came out and the parser complained: say the file could not be read.
    if (items.length === 0 && unreadable) errors.unshift(unreadable);
    return { items, errors };
}

/**
 * Reads a chosen file: one over BULK_SHIP_CSV_MAX_BYTES is refused before it is
 * read, so a huge export cannot freeze the page.
 */
export async function readBulkShipCsvFile(
    file: Pick<File, 'size' | 'text'>,
    rows: readonly BulkShipRowInput[]
): Promise<BulkShipCsvResult> {
    if (file.size > BULK_SHIP_CSV_MAX_BYTES) return { items: [], errors: [{ line: 0, key: 'tooLarge' }] };
    return parseBulkShipCsv(await file.text(), rows);
}

/** The first problems to list and how many more there are. */
export function shownProblems<T>(errors: readonly T[], limit = BULK_SHIP_CSV_SHOWN_PROBLEMS) {
    return { shown: errors.slice(0, limit), more: Math.max(0, errors.length - limit) };
}
