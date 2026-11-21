import { describe, expect, it } from 'vitest';
import { classify, filesFromDrop, filesFromEntries, isSkippedName } from './folder-intake';

type FakeEntry = FileSystemEntry;

const fileEntry = (name: string): FakeEntry =>
    ({
        name,
        isFile: true,
        isDirectory: false,
        file: (ok: (f: File) => void) => ok(new File(['x'], name, { type: 'image/jpeg' })),
    }) as unknown as FakeEntry;

/** A folder whose reader hands entries back `batch` at a time, like Chrome's 100. */
const dirEntry = (name: string, children: FakeEntry[], batch = 2): FakeEntry =>
    ({
        name,
        isFile: false,
        isDirectory: true,
        createReader: () => {
            let at = 0;
            return {
                readEntries: (ok: (entries: FakeEntry[]) => void) => {
                    const next = children.slice(at, at + batch);
                    at += next.length;
                    setTimeout(() => ok(next), 0);
                },
            };
        },
    }) as unknown as FakeEntry;

describe('filesFromEntries', () => {
    it('reads a folder whose reader answers in batches, sub-folders included', async () => {
        const tree = dirEntry('Pass 1', [
            fileEntry('Scan.jpeg'),
            fileEntry('Scan 1.jpeg'),
            fileEntry('Scan 2.jpeg'),
            dirEntry('more', [fileEntry('Scan 3.jpeg'), fileEntry('Scan 4.jpeg')]),
            fileEntry('Scan 5.jpeg'),
        ]);
        const files = await filesFromEntries([tree]);
        expect(files.map((f) => f.name).sort()).toEqual([
            'Scan 1.jpeg',
            'Scan 2.jpeg',
            'Scan 3.jpeg',
            'Scan 4.jpeg',
            'Scan 5.jpeg',
            'Scan.jpeg',
        ]);
    });

    it('skips dotfiles, .DS_Store, Thumbs.db and hidden folders', async () => {
        const tree = dirEntry('Pass 1', [
            fileEntry('.DS_Store'),
            fileEntry('._Scan.jpeg'),
            fileEntry('Thumbs.db'),
            dirEntry('.hidden', [fileEntry('Scan 9.jpeg')]),
            fileEntry('Scan.jpeg'),
        ]);
        const files = await filesFromEntries([tree]);
        expect(files.map((f) => f.name)).toEqual(['Scan.jpeg']);
    });
});

describe('filesFromDrop', () => {
    it('walks dropped folders through webkitGetAsEntry', async () => {
        const tree = dirEntry('Pass 2', [fileEntry('Scan.jpeg'), fileEntry('Scan 1.jpeg')]);
        const dt = {
            items: [{ kind: 'file', webkitGetAsEntry: () => tree }],
            files: [],
        } as unknown as DataTransfer;
        const files = await filesFromDrop(dt);
        expect(files.map((f) => f.name).sort()).toEqual(['Scan 1.jpeg', 'Scan.jpeg']);
    });

    it('falls back to the plain file list when entries are not available', async () => {
        const plain = [new File(['x'], 'Scan.jpeg'), new File(['x'], '.DS_Store')];
        const dt = { items: [], files: plain } as unknown as DataTransfer;
        const files = await filesFromDrop(dt);
        expect(files.map((f) => f.name)).toEqual(['Scan.jpeg']);
    });
});

describe('classify / isSkippedName', () => {
    it('accepts JPEG, PNG and PDF by type or extension and refuses HEIC / TIFF', () => {
        expect(classify({ name: 'Scan.jpeg', type: 'image/jpeg' })).toBe('IMAGE');
        expect(classify({ name: 'Scan 1.JPG', type: '' })).toBe('IMAGE');
        expect(classify({ name: 'page.png', type: '' })).toBe('IMAGE');
        expect(classify({ name: 'pile.pdf', type: '' })).toBe('PDF');
        expect(classify({ name: 'blob', type: 'application/pdf' })).toBe('PDF');
        expect(classify({ name: 'IMG_1.HEIC', type: 'image/heic' })).toBe('UNSUPPORTED');
        expect(classify({ name: 'scan.tif', type: '' })).toBe('UNSUPPORTED');
        expect(classify({ name: 'notes.txt', type: 'text/plain' })).toBe('UNSUPPORTED');
    });

    it('treats dotfiles and folder litter as skipped', () => {
        expect(isSkippedName('.DS_Store')).toBe(true);
        expect(isSkippedName('thumbs.db')).toBe(true);
        expect(isSkippedName('Scan.jpeg')).toBe(false);
    });
});
