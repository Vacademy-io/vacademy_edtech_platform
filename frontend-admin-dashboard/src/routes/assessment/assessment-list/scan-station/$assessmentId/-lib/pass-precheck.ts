import * as pdfjs from 'pdfjs-dist';
import { classify, type ScanFileClass } from './folder-intake';

/**
 * Checks a load's two passes before a byte is uploaded. Every error here blocks
 * the load: fronts and backs are paired by position, so a missing or doubled
 * page would put one student's page into another's copy.
 */

export const MAX_PAGES_PER_PASS = 100;

/** pdfjs-dist is pinned at 3.11.174; its worker must be the same build. */
const PDF_WORKER_SRC = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export type PrecheckError =
    | 'COUNT_MISMATCH'
    | 'UNSUPPORTED_FILE'
    | 'PDF_UNREADABLE'
    | 'EMPTY_PASS'
    | 'TOO_MANY_PAGES'
    | 'DUPLICATE_FILE'
    | 'MIXED_KINDS';

export interface PrecheckResult {
    /** Pages in the first and second pass. */
    pageCounts: [number, number];
    errors: PrecheckError[];
    /** Names of files that are not JPEG, PNG or PDF. */
    unsupported: string[];
    /** Names of files that are byte-for-byte the same as an earlier file. */
    duplicates: string[];
    /** Names of PDFs that would not open. */
    unreadable: string[];
    /** Pages per file, in the order given, for each pass. */
    filePages: [number[], number[]];
    /** Kind per file, in the order given, for each pass. */
    fileKinds: [ScanFileClass[], ScanFileClass[]];
}

/**
 * Pages in a PDF, or a throw. Unlike countPdfPages (which says 1 on any failure,
 * fine for a price quote) a scan load must never be counted on a guess.
 */
export const strictPdfPageCount = async (file: Blob): Promise<number> => {
    // Set here, not once per module: another screen may have pointed pdfjs at a
    // different worker build, and the last module to load would win.
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages = pdf.numPages;
    void pdf.destroy();
    if (!Number.isInteger(pages) || pages < 1) throw new Error('PDF has no pages');
    return pages;
};

const sha256 = async (file: Blob): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Files with equal size and SHA-256; only same-size files are hashed. */
const findDuplicates = async (files: File[]): Promise<string[]> => {
    const bySize = new Map<number, File[]>();
    for (const f of files) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f]);
    const duplicates: string[] = [];
    for (const group of bySize.values()) {
        if (group.length < 2) continue;
        const seen = new Set<string>();
        for (const f of group) {
            const hash = await sha256(f);
            if (seen.has(hash)) duplicates.push(f.name);
            else seen.add(hash);
        }
    }
    return duplicates;
};

const countPass = async (
    files: File[],
    unsupported: string[],
    unreadable: string[]
): Promise<{ pages: number[]; kinds: ScanFileClass[] }> => {
    const kinds = files.map((f) => classify(f));
    const pages = await Promise.all(
        files.map(async (f, i) => {
            const kind = kinds[i];
            if (kind === 'IMAGE') return 1;
            if (kind === 'PDF') {
                try {
                    return await strictPdfPageCount(f);
                } catch {
                    unreadable.push(f.name);
                    return 0;
                }
            }
            unsupported.push(f.name);
            return 0;
        })
    );
    return { pages, kinds };
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const precheckLoad = async (
    first: File[],
    second: File[],
    maxPagesPerPass = MAX_PAGES_PER_PASS,
    /** One-sided copies: one pass only, so no second pass and nothing to compare. */
    oneSided = false
): Promise<PrecheckResult> => {
    const unsupported: string[] = [];
    const unreadable: string[] = [];
    const [a, b] = await Promise.all([
        countPass(first, unsupported, unreadable),
        countPass(second, unsupported, unreadable),
    ]);
    const pageCounts: [number, number] = [sum(a.pages), sum(b.pages)];
    const errors: PrecheckError[] = [];

    if (first.length === 0 || (!oneSided && second.length === 0)) errors.push('EMPTY_PASS');
    if (unsupported.length > 0) errors.push('UNSUPPORTED_FILE');
    if (unreadable.length > 0) errors.push('PDF_UNREADABLE');
    const mixed = [a.kinds, b.kinds].some(
        (kinds) => kinds.includes('IMAGE') && kinds.includes('PDF')
    );
    if (mixed) errors.push('MIXED_KINDS');
    if (pageCounts[0] > maxPagesPerPass || pageCounts[1] > maxPagesPerPass) {
        errors.push('TOO_MANY_PAGES');
    }
    // Counts are only comparable when every file was counted.
    const counted = unsupported.length === 0 && unreadable.length === 0;
    if (
        !oneSided &&
        counted &&
        first.length > 0 &&
        second.length > 0 &&
        pageCounts[0] !== pageCounts[1]
    ) {
        errors.push('COUNT_MISMATCH');
    }
    const duplicates = await findDuplicates([...first, ...second]);
    if (duplicates.length > 0) errors.push('DUPLICATE_FILE');

    return {
        pageCounts,
        errors,
        unsupported,
        duplicates,
        unreadable,
        filePages: [a.pages, b.pages],
        fileKinds: [a.kinds, b.kinds],
    };
};
