import { describe, expect, it } from 'vitest';
import { orderScanFiles } from './order-files';

const T0 = 1_731_900_000_000;
const f = (name: string, lastModified = T0) => ({ name, lastModified });
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

/** Image Capture's names for a pass of n pages, mtimes 2 s apart. */
const imageCapture = (n: number, skip: number[] = []) =>
    Array.from({ length: n }, (_, i) => i)
        .filter((i) => !skip.includes(i))
        .map((i) => f(i === 0 ? 'Scan.jpeg' : `Scan ${i}.jpeg`, T0 + i * 2000));

describe('orderScanFiles — Image Capture numbering', () => {
    it("puts 'Scan' first and 'Scan 12' last, whatever order the folder listed them in", () => {
        const files = imageCapture(13).reverse();
        const r = orderScanFiles(files);
        expect(r.source).toBe('IMAGE_CAPTURE_SUFFIX');
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.ordered[0]!.name).toBe('Scan.jpeg');
        expect(r.ordered[1]!.name).toBe('Scan 1.jpeg');
        expect(r.ordered[2]!.name).toBe('Scan 2.jpeg');
        expect(r.ordered[12]!.name).toBe('Scan 12.jpeg');
    });

    it('blocks a pass with a page missing in the middle and says which', () => {
        const r = orderScanFiles(imageCapture(13, [7]));
        expect(r.errors).toContain('INDEX_GAP');
        expect(r.gapAfter).toBe('Scan 6.jpeg');
        expect(r.missingIndex).toBe(7);
    });

    it('blocks a page number seen twice', () => {
        const files = [...imageCapture(5), f('scan 3.JPG', T0 + 3 * 2000)];
        const r = orderScanFiles(files);
        expect(r.errors).toContain('DUPLICATE_INDEX');
        expect(r.duplicateNames).toHaveLength(1);
    });
});

describe('orderScanFiles — other numbering', () => {
    it("orders '(2)' style suffixes by their number", () => {
        const files = [f('page (10).jpg'), f('page (2).jpg'), f('page.jpg'), f('page (1).jpg')];
        const r = orderScanFiles([
            ...files,
            ...[3, 4, 5, 6, 7, 8, 9].map((n) => f(`page (${n}).jpg`)),
        ]);
        expect(r.source).toBe('NUMERIC_SUFFIX');
        expect(r.errors).toEqual([]);
        expect(names(r.ordered).slice(0, 3)).toEqual(['page.jpg', 'page (1).jpg', 'page (2).jpg']);
        expect(r.ordered.at(-1)!.name).toBe('page (10).jpg');
    });

    it('reads _003 style suffixes', () => {
        const r = orderScanFiles([f('sheet_003.pdf'), f('sheet_001.pdf'), f('sheet_002.pdf')]);
        expect(r.source).toBe('NUMERIC_SUFFIX');
        expect(names(r.ordered)).toEqual(['sheet_001.pdf', 'sheet_002.pdf', 'sheet_003.pdf']);
    });

    it('refuses two numbering series in one pass', () => {
        const r = orderScanFiles([f('a_1.jpg'), f('a_2.jpg'), f('b_1.jpg'), f('b_2.jpg')]);
        expect(r.errors).toContain('MIXED_STEMS');
    });

    it('falls back to modified time when names carry no number', () => {
        const r = orderScanFiles([
            f('lion.jpg', T0 + 4000),
            f('apple.jpg', T0 + 8000),
            f('zebra.jpg', T0),
        ]);
        expect(r.source).toBe('MODIFIED_TIME');
        expect(names(r.ordered)).toEqual(['zebra.jpg', 'lion.jpg', 'apple.jpg']);
    });

    it('falls back to natural name order when modified times tie', () => {
        const r = orderScanFiles([f('b.jpg'), f('a.jpg'), f('c.jpg')]);
        expect(r.source).toBe('NAME');
        expect(names(r.ordered)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    });
});

describe('orderScanFiles — modified-time cross-check', () => {
    it('warns when a later page was saved well before an earlier one', () => {
        const files = imageCapture(6);
        files[4] = f('Scan 4.jpeg', T0 - 5000);
        const r = orderScanFiles(files);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual(['MTIME_DISAGREES']);
    });

    it('ignores 200 ms of clock jitter', () => {
        const files = imageCapture(6);
        const fourth = f('Scan 4.jpeg', files[3]!.lastModified - 200);
        files[4] = fourth;
        files[5] = f('Scan 5.jpeg', fourth.lastModified + 1000);
        const r = orderScanFiles(files);
        expect(r.warnings).toEqual([]);
    });
});

describe('orderScanFiles — files built from the scan helper', () => {
    const helperPass = (prefix: string, n: number) =>
        Array.from({ length: n }, (_, i) =>
            f(`${prefix}-${String(i + 1).padStart(3, '0')}.jpg`, T0 + i * 1000)
        );

    it('orders pass1-001.jpg … pass1-012.jpg by their number, whatever the listing order', () => {
        const files = helperPass('pass1', 12);
        const shuffled = [
            files[7]!,
            files[0]!,
            files[11]!,
            ...files.slice(1, 7),
            ...files.slice(8, 11),
        ];
        const r = orderScanFiles(shuffled);
        expect(r.source).toBe('NUMERIC_SUFFIX');
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(names(r.ordered)).toEqual(names(files));
    });

    it('reads pass2- and scan- names the same way, past 99 pages too', () => {
        const pass2 = orderScanFiles([...helperPass('pass2', 120)].reverse());
        expect(pass2.errors).toEqual([]);
        expect(pass2.ordered[0]!.name).toBe('pass2-001.jpg');
        expect(pass2.ordered[99]!.name).toBe('pass2-100.jpg');
        expect(pass2.ordered.at(-1)!.name).toBe('pass2-120.jpg');

        const one = orderScanFiles(helperPass('scan', 1));
        expect(one.errors).toEqual([]);
        expect(names(one.ordered)).toEqual(['scan-001.jpg']);
    });

    it('still blocks a helper pass with a page missing', () => {
        const files = helperPass('pass1', 5).filter((x) => x.name !== 'pass1-003.jpg');
        const r = orderScanFiles(files);
        expect(r.errors).toContain('INDEX_GAP');
        expect(r.gapAfter).toBe('pass1-002.jpg');
    });
});
