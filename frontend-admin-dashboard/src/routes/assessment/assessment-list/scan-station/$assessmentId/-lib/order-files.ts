/**
 * Put one pass's files in the order the scanner fed the sheets.
 *
 * Rules, first that fits wins:
 * 1. Image Capture (macOS) numbering: "Scan.jpeg", "Scan 1.jpeg", "Scan 2.jpeg"…
 *    One common stem; a file without a number is index 0.
 * 2. Any trailing integer: "page (2).jpg", "scan_003.pdf", "IMG-12.png".
 * 3. The files' modified times, when no two are equal.
 * 4. Natural name order.
 *
 * Numbered rules must give contiguous indices (a gap = a missing page, a repeat =
 * a page saved twice); both block the load because the pairing of fronts and
 * backs is by position. Modified times are cross-checked against the numbering
 * and a real inversion (> 1 s; scanners stamp a page every second or two) is a
 * warning the server keeps as a review flag.
 */

export type ScanOrderSourceCode =
    | 'IMAGE_CAPTURE_SUFFIX'
    | 'NUMERIC_SUFFIX'
    | 'MODIFIED_TIME'
    | 'NAME';
export type ScanOrderWarning = 'MTIME_DISAGREES';
export type ScanOrderError = 'DUPLICATE_INDEX' | 'INDEX_GAP' | 'MIXED_STEMS';

export interface OrderableFile {
    name: string;
    lastModified: number;
}

export interface OrderedFiles<T extends OrderableFile> {
    ordered: T[];
    source: ScanOrderSourceCode;
    warnings: ScanOrderWarning[];
    errors: ScanOrderError[];
    /** INDEX_GAP: the last file before the first missing number. */
    gapAfter?: string;
    /** INDEX_GAP: the first missing number. */
    missingIndex?: number;
    /** DUPLICATE_INDEX: the files that share a number with an earlier one. */
    duplicateNames?: string[];
}

/** Larger mtime step backwards than this is a real inversion, not clock jitter. */
export const MTIME_JITTER_MS = 1000;

const IMAGE_CAPTURE = /^(.*?)(?: (\d+))?\.(jpe?g|png|pdf)$/i;
/** Base name (no extension) ending in a number, optionally in brackets or after _ - . or space. */
const TRAILING_INT = /^(.*?)[\s_.-]*\(?(\d+)\)?$/;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

interface Indexed<T> {
    file: T;
    stem: string;
    index: number;
}

/** Image Capture parse, or null when any file does not fit or the stems differ. */
const byImageCapture = <T extends OrderableFile>(files: T[]): Indexed<T>[] | null => {
    const parsed: Indexed<T>[] = [];
    for (const file of files) {
        const m = IMAGE_CAPTURE.exec(file.name);
        if (!m) return null;
        parsed.push({ file, stem: (m[1] ?? '').toLowerCase(), index: m[2] ? Number(m[2]) : 0 });
    }
    const stems = new Set(parsed.map((p) => p.stem));
    return stems.size === 1 ? parsed : null;
};

/**
 * Trailing-integer parse, or null when a file has no number (a single number-less
 * file whose name is the common stem counts as 0, like "page.jpg" next to "page (1).jpg").
 */
const byTrailingInteger = <T extends OrderableFile>(
    files: T[]
): { parsed: Indexed<T>[]; mixed: boolean } | null => {
    const numbered: Indexed<T>[] = [];
    const bare: T[] = [];
    for (const file of files) {
        const m = TRAILING_INT.exec(baseName(file.name));
        if (m && m[2] !== undefined) {
            numbered.push({ file, stem: (m[1] ?? '').trim().toLowerCase(), index: Number(m[2]) });
        } else {
            bare.push(file);
        }
    }
    if (numbered.length === 0) return null;
    const stems = new Set(numbered.map((p) => p.stem));
    if (bare.length > 0) {
        const stem = [...stems][0];
        const fits =
            stems.size === 1 && bare.every((f) => baseName(f.name).trim().toLowerCase() === stem);
        if (!fits) return null;
        for (const file of bare) numbered.push({ file, stem: stem ?? '', index: 0 });
    }
    return { parsed: numbered, mixed: stems.size > 1 };
};

const mtimeInverted = <T extends OrderableFile>(ordered: T[]): boolean => {
    for (let i = 1; i < ordered.length; i += 1) {
        const prev = ordered[i - 1]!;
        const cur = ordered[i]!;
        if (prev.lastModified - cur.lastModified > MTIME_JITTER_MS) return true;
    }
    return false;
};

const finishNumbered = <T extends OrderableFile>(
    parsed: Indexed<T>[],
    source: ScanOrderSourceCode,
    mixed: boolean
): OrderedFiles<T> => {
    const sorted = [...parsed].sort(
        (a, b) =>
            collator.compare(a.stem, b.stem) ||
            a.index - b.index ||
            collator.compare(a.file.name, b.file.name)
    );
    const ordered = sorted.map((p) => p.file);
    const errors: ScanOrderError[] = [];
    const result: OrderedFiles<T> = { ordered, source, warnings: [], errors };
    if (mixed) {
        // Two numbering series in one pass: there is no way to know how they interleave.
        errors.push('MIXED_STEMS');
        return result;
    }
    const duplicateNames: string[] = [];
    let gapAt = -1;
    for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1]!;
        const cur = sorted[i]!;
        if (cur.index === prev.index) duplicateNames.push(cur.file.name);
        else if (cur.index !== prev.index + 1 && gapAt < 0) gapAt = i;
    }
    if (duplicateNames.length > 0) {
        errors.push('DUPLICATE_INDEX');
        result.duplicateNames = duplicateNames;
    }
    if (gapAt > 0) {
        const before = sorted[gapAt - 1]!;
        errors.push('INDEX_GAP');
        result.gapAfter = before.file.name;
        result.missingIndex = before.index + 1;
    }
    if (mtimeInverted(ordered)) result.warnings.push('MTIME_DISAGREES');
    return result;
};

export const orderScanFiles = <T extends OrderableFile>(files: T[]): OrderedFiles<T> => {
    if (files.length === 0) {
        return { ordered: [], source: 'NAME', warnings: [], errors: [] };
    }
    const imageCapture = byImageCapture(files);
    if (imageCapture) return finishNumbered(imageCapture, 'IMAGE_CAPTURE_SUFFIX', false);

    const trailing = byTrailingInteger(files);
    if (trailing) return finishNumbered(trailing.parsed, 'NUMERIC_SUFFIX', trailing.mixed);

    const times = new Set(files.map((f) => f.lastModified));
    if (times.size === files.length) {
        const ordered = [...files].sort((a, b) => a.lastModified - b.lastModified);
        return { ordered, source: 'MODIFIED_TIME', warnings: [], errors: [] };
    }

    const ordered = [...files].sort((a, b) => collator.compare(a.name, b.name));
    return {
        ordered,
        source: 'NAME',
        warnings: mtimeInverted(ordered) ? ['MTIME_DISAGREES'] : [],
        errors: [],
    };
};
