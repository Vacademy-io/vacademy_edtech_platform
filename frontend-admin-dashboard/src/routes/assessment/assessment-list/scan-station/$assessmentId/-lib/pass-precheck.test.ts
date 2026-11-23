import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocument = vi.fn();
vi.mock('pdfjs-dist', () => ({
    version: '3.11.174',
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: (...args: unknown[]) => getDocument(...args),
}));

import { precheckLoad, strictPdfPageCount } from './pass-precheck';

const jpeg = (name: string, body = name) => new File([body], name, { type: 'image/jpeg' });
const pdf = (name: string, body = name) => new File([body], name, { type: 'application/pdf' });
const pass = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) =>
        jpeg(i === 0 ? 'Scan.jpeg' : `Scan ${i}.jpeg`, `${prefix}${i}`)
    );

beforeEach(() => {
    getDocument.mockReset();
});

describe('precheckLoad', () => {
    it('passes two equal passes of images', async () => {
        const r = await precheckLoad(pass(4, 'a'), pass(4, 'b'));
        expect(r.errors).toEqual([]);
        expect(r.pageCounts).toEqual([4, 4]);
        expect(r.filePages).toEqual([
            [1, 1, 1, 1],
            [1, 1, 1, 1],
        ]);
    });

    it('blocks passes with different page counts', async () => {
        const r = await precheckLoad(pass(24, 'a'), pass(23, 'b'));
        expect(r.errors).toEqual(['COUNT_MISMATCH']);
        expect(r.pageCounts).toEqual([24, 23]);
    });

    it('blocks a HEIC file and names it', async () => {
        const heic = new File(['h'], 'IMG_4.HEIC', { type: 'image/heic' });
        const r = await precheckLoad([...pass(2, 'a'), heic], pass(3, 'b'));
        expect(r.errors).toContain('UNSUPPORTED_FILE');
        expect(r.unsupported).toEqual(['IMG_4.HEIC']);
        expect(r.errors).not.toContain('COUNT_MISMATCH');
    });

    it('blocks a PDF pdfjs cannot open, instead of counting it as one page', async () => {
        getDocument.mockImplementation(() => ({
            promise: Promise.reject(new Error('Invalid PDF structure')),
        }));
        const r = await precheckLoad([pdf('first.pdf')], [pdf('second.pdf', 'other')]);
        expect(r.errors).toContain('PDF_UNREADABLE');
        expect(r.unreadable.sort()).toEqual(['first.pdf', 'second.pdf']);
    });

    it('counts PDF pages strictly', async () => {
        getDocument.mockImplementation(() => ({
            promise: Promise.resolve({ numPages: 12, destroy: () => Promise.resolve() }),
        }));
        const r = await precheckLoad([pdf('first.pdf')], [pdf('second.pdf', 'other')]);
        expect(r.errors).toEqual([]);
        expect(r.pageCounts).toEqual([12, 12]);
    });

    it('blocks the same file added twice', async () => {
        const first = pass(3, 'a');
        const second = [
            jpeg('Scan.jpeg', 'b0'),
            jpeg('Scan 1.jpeg', 'a1'),
            jpeg('Scan 2.jpeg', 'b2'),
        ];
        const r = await precheckLoad(first, second);
        expect(r.errors).toEqual(['DUPLICATE_FILE']);
        expect(r.duplicates).toEqual(['Scan 1.jpeg']);
    });

    it('blocks an empty pass, a pass over the cap and a pass mixing PDFs and images', async () => {
        expect((await precheckLoad([], pass(2, 'b'))).errors).toContain('EMPTY_PASS');
        expect((await precheckLoad(pass(3, 'a'), pass(3, 'b'), 2)).errors).toContain(
            'TOO_MANY_PAGES'
        );
        getDocument.mockImplementation(() => ({
            promise: Promise.resolve({ numPages: 1, destroy: () => Promise.resolve() }),
        }));
        const mixed = await precheckLoad([jpeg('Scan.jpeg', 'x'), pdf('Scan 1.pdf')], pass(2, 'b'));
        expect(mixed.errors).toContain('MIXED_KINDS');
    });
});

describe('strictPdfPageCount', () => {
    it('throws rather than guessing', async () => {
        getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error('bad')) }));
        await expect(strictPdfPageCount(pdf('x.pdf'))).rejects.toThrow('bad');
    });
});
