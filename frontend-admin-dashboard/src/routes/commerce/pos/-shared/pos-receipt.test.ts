/** POS review follow-ups: the 80 mm print setup (MINOR 3). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localeT } from '@/routes/commerce/-shared/en-t';
import { PAGE_RULE, PAGE_STYLE_ID, PRINTING_CLASS, endReceiptPrint, printReceipt, receiptRows } from './pos-receipt';
import { receipt } from './pos-test-fixtures';

afterEach(() => {
    endReceiptPrint();
    vi.restoreAllMocks();
});

describe('printReceipt', () => {
    it('never pairs a length with auto in @page (the browser would drop the size)', () => {
        expect(PAGE_RULE).not.toMatch(/size:\s*\d+mm\s+auto/);
    });

    it('a print whose afterprint never fires is ended when the screen goes away', () => {
        vi.spyOn(window, 'print').mockImplementation(() => undefined);
        printReceipt(window);
        expect(document.body.classList.contains(PRINTING_CLASS)).toBe(true);
        expect(document.getElementById(PAGE_STYLE_ID)).not.toBeNull();
        endReceiptPrint();
        expect(document.body.classList.contains(PRINTING_CLASS)).toBe(false);
        expect(document.getElementById(PAGE_STYLE_ID)).toBeNull();
    });

    it('afterprint ends it too', () => {
        vi.spyOn(window, 'print').mockImplementation(() => undefined);
        printReceipt(window);
        window.dispatchEvent(new Event('afterprint'));
        expect(document.body.classList.contains(PRINTING_CLASS)).toBe(false);
    });
});

describe('receiptRows: measured lines (WP-44 FA5)', () => {
    it('a 3.4 m line reads "3.4 m × ₹123.40 / m"; a bottle keeps its old text', () => {
        const model = receiptRows(
            receipt({
                lines: [
                    { name: 'Cotton cloth', variant_label: null, quantity: 34, qty_scale: 10, unit: 'MTR', unit_price: 12.34, discount: 0, net: 419.56, hsn_code: null, tax_rate: null },
                    { name: 'Steel bottle', variant_label: null, quantity: 2, qty_scale: 1, unit: 'PCS', unit_price: 450, discount: 0, net: 900, hsn_code: null, tax_rate: null },
                ],
            }),
            localeT('en'),
            'en'
        );
        expect(model.items[0]).toMatchObject({ quantity: '3.4 m', rate: '₹123.40 / m', amount: '₹419.56' });
        expect(model.items[1]).toMatchObject({ quantity: '2', rate: '₹450.00', amount: '₹900.00' });
    });
});
