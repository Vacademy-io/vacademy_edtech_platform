/** Browser label printing (owner decision 2026-11-18) and the challan PDF opening (contract §7.7). */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import type { PrintLabel } from './inventory-types';
import {
    a4Sheets,
    expandCopies,
    LABEL_PRINTING_CLASS,
    labelCount,
    labelsNotQueued,
    labelText,
    markPrintedBatches,
    openPdf,
    pageRule,
    printLabels,
    printProblem,
    printRounds,
} from './label-print';

const label = (code: string, copies = 1): PrintLabel => ({
    request_id: code,
    code,
    qr_value: `https://shop.example/q/${code}`,
    product_name: { en: 'Cotton scarf', hi: 'सूती दुपट्टा' },
    variant_name: { en: null, hi: null },
    price: 1200,
    currency: 'INR',
    unit: 'PCS',
    sku: 'SCARF-1',
    copies,
});

describe('what gets printed', () => {
    it('counts labels by quantity; more than 500 is not a stop (they print in rounds of 500)', () => {
        expect(labelCount([{ quantity: 3 }, { quantity: 1 }])).toBe(4);
        const sticker = { template: 'STICKER_50X25' as const, language: 'both' as const, startPosition: 99 };
        expect(printProblem(0, sticker)).toBe('nothing');
        expect(printProblem(1200, sticker)).toBeNull();
        expect(printProblem(500, sticker)).toBeNull();
        expect([printRounds(1), printRounds(500), printRounds(501), printRounds(1200)]).toEqual([1, 1, 2, 3]);
    });

    it('mark printed: a row drawn in part says how many labels were drawn; batches of 200 ids', () => {
        const labels = [
            { ...label('VBIG000001', 500), request_id: 'big' },
            { ...label('VSMALL0001', 2), request_id: 'small' },
        ];
        expect(markPrintedBatches({ labels, left_out: [{ request_id: 'big', sku: null, copies: 700 }] })).toEqual([
            { request_ids: ['big', 'small'], printed_copies: { big: 500 } },
        ]);
        expect(markPrintedBatches({ labels, left_out: [] })).toEqual([{ request_ids: ['big', 'small'] }]);
        const many = Array.from({ length: 201 }, (_, i) => ({ ...label(`V${i}`), request_id: `r${i}` }));
        const batches = markPrintedBatches({ labels: many, left_out: [{ request_id: 'r200', sku: null, copies: 5 }] });
        expect(batches.map((b) => b.request_ids.length)).toEqual([200, 1]);
        expect(batches[0]?.printed_copies).toBeUndefined();
        expect(batches[1]?.printed_copies).toEqual({ r200: 1 });
    });

    it('receipt lines of more than 10,000 counted units say how many got no label', () => {
        const line = { sku: 'B-1', product_name: 'Button', stock_mode: 'QUANTITY', qty_scale: 1, qty_received: 12_500 };
        expect(labelsNotQueued([line])).toEqual([{ item: 'B-1', units: 2500 }]);
        expect(labelsNotQueued([{ ...line, qty_received: 10_000 }])).toEqual([]);
        expect(labelsNotQueued([{ ...line, qty_scale: 10 }])).toEqual([]);
        expect(labelsNotQueued([{ ...line, stock_mode: 'PIECE' }])).toEqual([]);
    });

    it('the start position counts on an A4 sheet only, 1..65', () => {
        const a4 = { template: 'A4_65' as const, language: 'both' as const, startPosition: 66 };
        expect(printProblem(1, a4)).toBe('startPosition');
        expect(printProblem(1, { ...a4, startPosition: 0 })).toBe('startPosition');
        expect(printProblem(1, { ...a4, startPosition: 65 })).toBeNull();
    });

    it('copies repeat; A4 start 7 leaves six used places, so the first label is row 2, column 2', () => {
        expect(expandCopies([label('V1', 3), label('P1')]).map((l) => l.code)).toEqual(['V1', 'V1', 'V1', 'P1']);
        const sheets = a4Sheets([label('V1', 59)], 7);
        expect(sheets).toHaveLength(1);
        expect(sheets[0]?.slice(0, 7).map((cell) => cell?.code ?? null)).toEqual([null, null, null, null, null, null, 'V1']);
        expect(a4Sheets([label('V1', 70)], 1).map((s) => s.length)).toEqual([65, 5]);
        expect(a4Sheets([label('V1', 60)], 7).map((s) => s.length)).toEqual([65, 1]);
    });

    it('names: Hindi first with English small below; one language falls back to the other', () => {
        expect(labelText({ en: 'Cotton scarf', hi: 'सूती दुपट्टा' }, 'both')).toEqual({ main: 'सूती दुपट्टा', small: 'Cotton scarf' });
        expect(labelText({ en: 'Cotton scarf', hi: null }, 'both')).toEqual({ main: 'Cotton scarf', small: null });
        expect(labelText({ en: 'Cotton scarf', hi: null }, 'hi')).toEqual({ main: 'Cotton scarf', small: null });
        expect(labelText({ en: 'Cotton scarf', hi: 'सूती दुपट्टा' }, 'en')).toEqual({ main: 'Cotton scarf', small: null });
    });

    it('the page is exact and without margins', () => {
        expect(pageRule('STICKER_50X25')).toBe('@page { size: 50mm 25mm; margin: 0; }');
        expect(pageRule('A4_65')).toBe('@page { size: 210mm 297mm; margin: 0; }');
    });
});

describe('printLabels', () => {
    it('sets the body class and the @page rule for this print only', async () => {
        let during: { cls: boolean; rule: string | null } | null = null;
        const print = vi.spyOn(window, 'print').mockImplementation(() => {
            during = {
                cls: document.body.classList.contains(LABEL_PRINTING_CLASS),
                rule: document.getElementById('inv-label-page')?.textContent ?? null,
            };
            window.dispatchEvent(new Event('afterprint'));
        });
        await printLabels('STICKER_50X25');
        expect(during).toEqual({ cls: true, rule: '@page { size: 50mm 25mm; margin: 0; }' });
        expect(document.body.classList.contains(LABEL_PRINTING_CLASS)).toBe(false);
        expect(document.getElementById('inv-label-page')).toBeNull();
        print.mockRestore();
    });
});

describe('openPdf (challan)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('opens the tab before the PDF is fetched, then points it at the file', async () => {
        const order: string[] = [];
        const tab = { closed: false, location: { href: '' }, close: vi.fn() };
        const win = { open: vi.fn(() => (order.push('open'), tab as unknown as Window)) };
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:challan');
        const result = await openPdf(async () => (order.push('fetch'), new Blob(['%PDF'], { type: 'application/pdf' })), 'DC-1.pdf', win);
        expect(order).toEqual(['open', 'fetch']);
        expect(result).toBe('opened');
        expect(tab.location.href).toBe('blob:challan');
    });

    it('with a popup blocker the file is downloaded instead', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:challan');
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        const result = await openPdf(async () => new Blob(['%PDF']), 'DC-1.pdf', { open: () => null });
        expect(result).toBe('downloaded');
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('a failed fetch closes the empty tab and rethrows', async () => {
        const tab = { closed: false, location: { href: '' }, close: vi.fn() };
        await expect(
            openPdf(async () => Promise.reject(new Error('409')), 'x.pdf', { open: () => tab as unknown as Window })
        ).rejects.toThrow('409');
        expect(tab.close).toHaveBeenCalled();
    });
});
