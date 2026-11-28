/** F11: the courier CSV for "Mark shipped". */
import { describe, expect, it, vi } from 'vitest';
import {
    BULK_SHIP_CSV_MAX_BYTES,
    parseBulkShipCsv,
    readBulkShipCsvFile,
    shownProblems,
} from './bulk-ship-csv';

const rows = [
    { order_id: 'o-1', order_number: 'SO-1' },
    { order_id: 'o-2', order_number: 'SO-2' },
];

describe('parseBulkShipCsv', () => {
    it('reads the header in any case and order', () => {
        const text = 'Tracking_Number,ORDER_NUMBER,Courier,tracking_link\nAWB1,so-1,Fast Courier,https://track.example/1\n';
        expect(parseBulkShipCsv(text, rows)).toEqual({
            items: [
                {
                    order_id: 'o-1',
                    carrier_name: 'Fast Courier',
                    tracking_number: 'AWB1',
                    tracking_url: 'https://track.example/1',
                },
            ],
            errors: [],
        });
    });

    it('an order number that is not ticked is refused with its line', () => {
        const text = 'order_number,courier,tracking_number\nSO-9,Fast Courier,AWB9\nSO-2,Fast Courier,AWB2\n';
        const result = parseBulkShipCsv(text, rows);
        expect(result.errors).toEqual([{ line: 2, key: 'notSelected', value: 'SO-9' }]);
        expect(result.items.map((item) => item.order_id)).toEqual(['o-2']);
    });

    it('a duplicate is refused', () => {
        const text = 'order_number,courier,tracking_number\nSO-1,A,1\nSO-1,B,2\n';
        expect(parseBulkShipCsv(text, rows).errors).toEqual([{ line: 3, key: 'duplicate', value: 'SO-1' }]);
    });

    it('a missing courier or tracking number is refused', () => {
        const text = 'order_number,courier,tracking_number\nSO-1,,AWB1\nSO-2,Fast Courier,\n';
        expect(parseBulkShipCsv(text, rows).errors.map((e) => e.key)).toEqual(['missingField', 'missingField']);
    });

    it('a file without the order_number column or rows', () => {
        expect(parseBulkShipCsv('courier,tracking_number\nA,1\n', rows).errors[0]?.key).toBe('noHeader');
        expect(parseBulkShipCsv('order_number,courier,tracking_number\n', rows).errors[0]?.key).toBe('empty');
    });
});

describe('bulk-ship CSV limits', () => {
    it('a file over 1 MB is refused before it is read', async () => {
        const text = vi.fn(async () => 'order_number\n');
        const result = await readBulkShipCsvFile({ size: BULK_SHIP_CSV_MAX_BYTES + 1, text }, rows);
        expect(result).toEqual({ items: [], errors: [{ line: 0, key: 'tooLarge' }] });
        expect(text).not.toHaveBeenCalled();
    });

    it('a file within the cap is parsed', async () => {
        const body = 'order_number,courier,tracking_number\nSO-1,Fast Courier,AWB1\n';
        const result = await readBulkShipCsvFile({ size: body.length, text: async () => body }, rows);
        expect(result.items.map((item) => item.order_id)).toEqual(['o-1']);
    });

    it('an unterminated quote with nothing usable says the file could not be read', () => {
        const text = 'order_number,courier,tracking_number\n"SO-1,Fast Courier,AWB1\nSO-2,Fast Courier,AWB2\n';
        const result = parseBulkShipCsv(text, rows);
        expect(result.items).toEqual([]);
        expect(result.errors[0]).toEqual({ line: 2, key: 'unreadable' });
    });

    it('a short row that still filled an order is not called unreadable', () => {
        const text = 'order_number,courier,tracking_number,tracking_link\nSO-1,Fast Courier,AWB1\n';
        const result = parseBulkShipCsv(text, rows);
        expect(result.items.map((item) => item.order_id)).toEqual(['o-1']);
        expect(result.errors).toEqual([]);
    });

    it('lists at most 20 problems and counts the rest', () => {
        const lines = Array.from({ length: 35 }, (_, i) => `SO-X${i},Fast Courier,AWB${i}`);
        const result = parseBulkShipCsv(`order_number,courier,tracking_number\n${lines.join('\n')}\n`, rows);
        expect(result.errors).toHaveLength(35);
        const { shown, more } = shownProblems(result.errors);
        expect(shown).toHaveLength(20);
        expect(shown[0]).toEqual({ line: 2, key: 'notSelected', value: 'SO-X0' });
        expect(more).toBe(15);
        expect(shownProblems(result.errors.slice(0, 3)).more).toBe(0);
    });
});
