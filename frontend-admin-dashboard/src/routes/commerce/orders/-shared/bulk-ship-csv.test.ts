/** F11: the courier CSV for "Mark shipped". */
import { describe, expect, it } from 'vitest';
import { parseBulkShipCsv } from './bulk-ship-csv';

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
