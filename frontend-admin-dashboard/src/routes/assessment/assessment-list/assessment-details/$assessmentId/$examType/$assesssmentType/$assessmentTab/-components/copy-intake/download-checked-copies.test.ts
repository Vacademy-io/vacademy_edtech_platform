import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopyIntakeCheckedCopy } from '../../-services/copy-intake-services';

// zip.js itself is exercised in the browser; happy-dom's streams cannot drive
// it, so the writer is a recorder and these tests cover what this module
// decides: which copies go in, under what names, and what is saved.
const zip: { entries: string[]; options: unknown } = { entries: [], options: null };
vi.mock('@zip.js/zip.js', () => ({
    BlobWriter: class {},
    BlobReader: class {
        constructor(public blob: Blob) {}
    },
    ZipWriter: class {
        constructor(_writer: unknown, options: unknown) {
            zip.options = options;
        }
        async add(name: string) {
            zip.entries.push(name);
        }
        async close() {
            return new Blob(['zip']);
        }
    },
}));

const saved: { blob: Blob | null; name: string | null } = { blob: null, name: null };
vi.mock('file-saver', () => ({
    saveAs: (blob: Blob, name: string) => {
        saved.blob = blob;
        saved.name = name;
    },
}));

const lookups: string[] = [];
vi.mock('@/services/upload_file', () => ({
    getPublicUrls: vi.fn(async (ids: string) => {
        lookups.push(ids);
        return ids.split(',').map((id) => ({ id, url: `https://media.test/${id}` }));
    }),
}));

import { downloadCheckedCopies } from './download-checked-copies';

const copy = (id: string, student: string | null, file: string | null): CopyIntakeCheckedCopy => ({
    item_id: `item-${id}`,
    file_name: file,
    student_name: student,
    roll: null,
    evaluated_file_id: id,
});

describe('downloadCheckedCopies', () => {
    beforeEach(() => {
        zip.entries = [];
        zip.options = null;
        saved.blob = null;
        saved.name = null;
        lookups.length = 0;
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => ({
                ok: !url.endsWith('/broken'),
                status: url.endsWith('/broken') ? 403 : 200,
                blob: async () => new Blob([`%PDF-1.4 ${url}`]),
            }))
        );
    });

    it('zips every checked copy under the student name and saves one file', async () => {
        const progress: number[] = [];
        const result = await downloadCheckedCopies(
            [copy('a', 'Asha Verma', '56.pdf'), copy('b', 'Ravi', '57.pdf'), copy('c', null, null)],
            'checked-copies-2026-10-15.zip',
            (done) => progress.push(done)
        );

        expect(result).toEqual({ added: 3, failed: 0 });
        expect(saved.name).toBe('checked-copies-2026-10-15.zip');
        expect(zip.entries.sort()).toEqual([
            'Asha Verma - 56.pdf',
            'Ravi - 57.pdf',
            'Student - item-c.pdf',
        ]);
        expect(progress.sort()).toEqual([1, 2, 3]);
        // Stored, not deflated, and no worker.
        expect(zip.options).toEqual({ level: 0, useWebWorkers: false });
    });

    it('leaves out a copy that cannot be fetched and keeps the rest', async () => {
        const result = await downloadCheckedCopies(
            [copy('a', 'Asha', '56.pdf'), copy('broken', 'Ravi', '57.pdf')],
            'x.zip',
            () => undefined
        );

        expect(result).toEqual({ added: 1, failed: 1 });
        expect(zip.entries).toEqual(['Asha - 56.pdf']);
        expect(saved.blob).not.toBeNull();
    });

    it('never names two entries the same, and keeps names file-system safe', async () => {
        await downloadCheckedCopies(
            [
                copy('a', 'Asha', '56.pdf'),
                copy('b', 'Asha', '56.pdf'),
                copy('c', 'A/B: C?', 'x.PDF'),
            ],
            'x.zip',
            () => undefined
        );
        expect(zip.entries.sort()).toEqual(['A B C - x.pdf', 'Asha - 56 (2).pdf', 'Asha - 56.pdf']);
    });

    it('saves nothing when no copy could be fetched', async () => {
        const result = await downloadCheckedCopies(
            [copy('broken', 'Ravi', '57.pdf')],
            'x.zip',
            () => undefined
        );
        expect(result).toEqual({ added: 0, failed: 1 });
        expect(saved.blob).toBeNull();
    });

    it('asks media for the URLs in small chunks', async () => {
        const many = Array.from({ length: 95 }, (_, i) => copy(`f${i}`, `S${i}`, `${i}.pdf`));
        await downloadCheckedCopies(many, 'x.zip', () => undefined);
        expect(lookups.map((l) => l.split(',').length)).toEqual([40, 40, 15]);
        expect(zip.entries).toHaveLength(95);
    });
});
