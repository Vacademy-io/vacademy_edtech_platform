/**
 * Fix round (reviews of WP-41): labels for "Tags to replace" per piece / roll /
 * unit in server-sized batches (H2, L9), marking exactly what was drawn (M1),
 * unpriced rows left waiting (M2), the print ends when its screen closes (L2),
 * the A4 QR of a long link (L3), unit signs (L10), the code line.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import type { PrintLabel, ToReplaceRow } from './inventory-types';
import {
    chunks,
    codeLine,
    drawnRequestIds,
    endLabelPrint,
    LABEL_PRINTING_CLASS,
    labelQrValue,
    labelWordsLanguage,
    MAX_REQUEST_LINES,
    perUnit,
    planReplaceLabels,
    printLabels,
    splitByPrice,
    unitSign,
} from './label-print';

const row = (id: string, over: Partial<ToReplaceRow> = {}): ToReplaceRow => ({
    package_session_id: id,
    sku: id.toUpperCase(),
    item_name: null,
    printed_mrp: 100,
    current_mrp: 120,
    on_hand: 4,
    stock_mode: 'QUANTITY',
    unit: 'PCS',
    qty_scale: 1,
    has_price: true,
    labels: 4,
    capped: false,
    ...over,
});

const printLabel = (requestId: string | null, copies = 1): PrintLabel => ({
    request_id: requestId,
    code: 'VABCDEFGH2',
    qr_value: 'VABCDEFGH2',
    product_name: { en: 'Bottle', hi: null },
    variant_name: { en: null, hi: null },
    price: 10,
    currency: 'INR',
    unit: 'PCS',
    sku: null,
    copies,
});

describe('tags to replace (H2, L9)', () => {
    it('a piece item is one line the server splits per piece; a measured item one label per roll; unpriced left out', () => {
        const plan = planReplaceLabels([
            row('saree', { stock_mode: 'PIECE', labels: 3, on_hand: 3 }),
            row('cloth', { unit: 'MTR', qty_scale: 10, on_hand: 200, labels: 1 }),
            row('cup', { labels: 4 }),
            row('new', { has_price: false, labels: 2 }),
        ]);
        expect(plan.batches).toEqual([
            [
                { package_session_id: 'saree', quantity: 1 },
                { package_session_id: 'cloth', quantity: 1 },
                { package_session_id: 'cup', quantity: 4 },
            ],
        ]);
        expect(plan.unpriced.map((r) => r.package_session_id)).toEqual(['new']);
    });

    it('more than 100 items go in batches of at most 100 lines; capped items are reported', () => {
        const rows = Array.from({ length: 150 }, (_, i) => row(`v${i}`, i === 0 ? { labels: 500, capped: true } : {}));
        const plan = planReplaceLabels(rows);
        expect(plan.batches.map((b) => b.length)).toEqual([MAX_REQUEST_LINES, 50]);
        expect(plan.capped.map((r) => r.package_session_id)).toEqual(['v0']);
    });

    it('piece items keep a batch within 500 server rows', () => {
        const plan = planReplaceLabels([
            row('a', { stock_mode: 'PIECE', labels: 300 }),
            row('b', { stock_mode: 'PIECE', labels: 300 }),
        ]);
        expect(plan.batches.map((b) => b.length)).toEqual([1, 1]);
    });
});

describe('print and mark (M1, M2)', () => {
    it('marks every drawn request once, in batches of at most 200', () => {
        const labels = Array.from({ length: 250 }, (_, i) => printLabel(`r${i}`));
        const ids = drawnRequestIds({ labels: [...labels, printLabel('r0', 3), printLabel(null)] });
        expect(ids).toHaveLength(250);
        expect(chunks(ids, 200).map((c) => c.length)).toEqual([200, 50]);
    });

    it('rows without a price wait', () => {
        const { priced, unpriced } = splitByPrice([
            { id: 'a', has_price: true },
            { id: 'b', has_price: false },
        ]);
        expect(priced.map((r) => r.id)).toEqual(['a']);
        expect(unpriced.map((r) => r.id)).toEqual(['b']);
    });
});

describe('the label face', () => {
    it('A4 QR holds the bare code when the shop link is long (L3); the sticker keeps the link', () => {
        const long = { code: 'PABCDEFGH2', qr_value: 'https://my-very-long-shop-name-example.vacademy.io/q/PABCDEFGH2' };
        expect(labelQrValue(long, true)).toBe('PABCDEFGH2');
        expect(labelQrValue(long, false)).toBe(long.qr_value);
        expect(labelQrValue({ code: 'P1', qr_value: 'https://shop.example/q/P1' }, true)).toBe('https://shop.example/q/P1');
    });

    it('units print as signs, never raw codes (L10)', () => {
        expect(perUnit('MTR')).toBe(' / m');
        expect(perUnit('KGS')).toBe(' / kg');
        expect(perUnit('PCS')).toBe('');
        expect(unitSign('BOX')).toBe('box');
    });

    it('label words follow the label language (L1); the SKU rides on the code line', () => {
        expect(labelWordsLanguage('en')).toBe('en');
        expect(labelWordsLanguage('both')).toBe('hi');
        expect(codeLine({ code: 'PABCDEFGH2', sku: 'DUP-1' })).toBe('PABCDEFGH2 · DUP-1');
        expect(codeLine({ code: 'PABCDEFGH2', sku: null })).toBe('PABCDEFGH2');
    });
});

describe('endLabelPrint (L2)', () => {
    it('ends a print whose afterprint never came: class and @page rule go at once', async () => {
        const win = { ...window, document, print: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Window;
        const done = printLabels('STICKER_50X25', win);
        expect(document.body.classList.contains(LABEL_PRINTING_CLASS)).toBe(true);
        expect(document.getElementById('inv-label-page')).not.toBeNull();
        endLabelPrint();
        await done;
        expect(document.body.classList.contains(LABEL_PRINTING_CLASS)).toBe(false);
        expect(document.getElementById('inv-label-page')).toBeNull();
    });

    it("an earlier print's cleanup leaves a newer print's class alone", async () => {
        const listeners: (() => void)[] = [];
        const win = {
            ...window,
            document,
            print: vi.fn(),
            addEventListener: (_: string, fn: () => void) => listeners.push(fn),
            removeEventListener: vi.fn(),
        } as unknown as Window;
        void printLabels('STICKER_50X25', win);
        const second = printLabels('A4_65', win);
        listeners[0]?.(); // the first print's afterprint, late
        expect(document.body.classList.contains(LABEL_PRINTING_CLASS)).toBe(true);
        expect(document.getElementById('inv-label-page')?.textContent).toContain('210mm');
        endLabelPrint();
        await second;
        expect(document.body.classList.contains(LABEL_PRINTING_CLASS)).toBe(false);
    });
});
