import Papa from 'papaparse';

/**
 * "Mark shipped" for many orders from a courier's CSV. Header
 * `order_number,courier,tracking_number,tracking_link` (any case, any order).
 * Only the ticked orders can be filled; every problem names its CSV line.
 */
export const BULK_SHIP_CSV_HEADER = ['order_number', 'courier', 'tracking_number', 'tracking_link'] as const;

export const BULK_SHIP_CSV_ERRORS = ['notSelected', 'duplicate', 'missingField', 'noHeader', 'empty'] as const;
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
    if (!fields.includes('order_number')) return { items: [], errors: [{ line: 1, key: 'noHeader' }] };
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
    return { items, errors };
}
