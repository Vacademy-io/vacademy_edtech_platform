/** POS review follow-ups: the 80 mm print setup (MINOR 3). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_RULE, PAGE_STYLE_ID, PRINTING_CLASS, endReceiptPrint, printReceipt } from './pos-receipt';

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
