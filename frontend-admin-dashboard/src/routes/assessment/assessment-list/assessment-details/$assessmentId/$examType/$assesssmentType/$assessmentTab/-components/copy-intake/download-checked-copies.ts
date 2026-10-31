import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';
import { saveAs } from 'file-saver';
import { getPublicUrls } from '@/services/upload_file';
import type { CopyIntakeCheckedCopy } from '../../-services/copy-intake-services';

/** File ids per media lookup: they travel in the query string. */
const URL_CHUNK = 40;
/** Copies fetched at once. Small on purpose: these are multi-MB scans. */
const PARALLEL = 3;

export interface CheckedCopiesDownloadResult {
    added: number;
    failed: number;
}

const safePart = (value: string) =>
    value
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

/** "Asha Verma - 56.pdf"; the student's name first so the zip sorts by student. */
const entryName = (copy: CopyIntakeCheckedCopy, taken: Set<string>) => {
    const who = safePart(copy.student_name || copy.roll || '') || 'Student';
    const file =
        safePart((copy.file_name || '').replace(/\.pdf$/i, '')) || copy.item_id.slice(0, 8);
    const base = `${who} - ${file}`;
    let name = `${base}.pdf`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).pdf`;
    taken.add(name.toLowerCase());
    return name;
};

const resolveUrls = async (fileIds: string[]): Promise<Map<string, string>> => {
    const urls = new Map<string, string>();
    for (let i = 0; i < fileIds.length; i += URL_CHUNK) {
        const details: unknown = await getPublicUrls(fileIds.slice(i, i + URL_CHUNK).join(','));
        if (!Array.isArray(details)) continue;
        for (const d of details as { id?: unknown; url?: unknown }[]) {
            if (typeof d?.id === 'string' && typeof d?.url === 'string' && d.url)
                urls.set(d.id, d.url);
        }
    }
    return urls;
};

/**
 * Zip every checked copy in the browser and save it as one file. The copies
 * already exist in storage; nothing is rendered or zipped on the server. A copy
 * that cannot be fetched is left out and counted, never fails the rest.
 */
export const downloadCheckedCopies = async (
    copies: CopyIntakeCheckedCopy[],
    zipName: string,
    onProgress: (done: number, total: number) => void
): Promise<CheckedCopiesDownloadResult> => {
    const urls = await resolveUrls(copies.map((c) => c.evaluated_file_id));
    // Stored, not deflated: scans are already compressed, and no worker is needed to store bytes.
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
        level: 0,
        useWebWorkers: false,
    });
    const taken = new Set<string>();
    const names = copies.map((c) => entryName(c, taken));
    let done = 0;
    let added = 0;
    let next = 0;

    const work = async () => {
        while (next < copies.length) {
            const index = next++;
            const copy = copies[index]!;
            const url = urls.get(copy.evaluated_file_id);
            try {
                if (!url) throw new Error('no url');
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                await writer.add(names[index]!, new BlobReader(await response.blob()));
                added++;
            } catch (e) {
                console.warn('[checked-copies] left out', copy.item_id, e);
            }
            onProgress(++done, copies.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, copies.length) }, work));

    const zip = await writer.close();
    if (added > 0) saveAs(zip, zipName);
    return { added, failed: copies.length - added };
};
