import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildCopyPdf, movePage } from './scan-pdf';

// A real 4x2 JPEG: pdf-lib reads the size from the file, so a fake would not embed.
const JPEG_4X2 = Uint8Array.from(
    atob(
        '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/wAALCAACAAQBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVL//2Q=='
    ),
    (c) => c.charCodeAt(0)
);

describe('buildCopyPdf', () => {
    it('makes one A4-wide page per scan, in order, keeping each photo’s shape', async () => {
        const bytes = await buildCopyPdf([
            { bytes: JPEG_4X2, width: 2400, height: 1200 },
            { bytes: JPEG_4X2, width: 1800, height: 2400 },
        ]);
        const pdf = await PDFDocument.load(bytes);
        const sizes = pdf.getPages().map((p) => p.getSize());
        expect(sizes).toEqual([
            { width: 595, height: 297.5 },
            { width: 595, height: (595 * 2400) / 1800 },
        ]);
    });

    it('refuses an empty copy instead of uploading a blank PDF', async () => {
        await expect(buildCopyPdf([])).rejects.toThrow();
    });
});

describe('movePage', () => {
    it('moves a page a place either way', () => {
        expect(movePage(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
        expect(movePage(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    });

    it('stays put at either end', () => {
        expect(movePage(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
        expect(movePage(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    });
});
