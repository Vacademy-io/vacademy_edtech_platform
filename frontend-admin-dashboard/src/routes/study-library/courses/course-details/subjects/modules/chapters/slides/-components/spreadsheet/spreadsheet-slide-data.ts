/**
 * Spreadsheet (Excel) slide — storage format and limits.
 *
 * A spreadsheet slide is a DOCUMENT slide with `document_slide.type =
 * "SPREADSHEET"`. Its `data` / `published_data` hold the JSON below, so drafts,
 * publish, copy, move and drip work exactly as for any other document slide and
 * no schema change is needed. The grid is the CBE sheet model
 * (`@/components/cbe` CbeSheet), converted in the browser from the uploaded
 * workbook; the original file is kept in media storage so learners can
 * download it.
 *
 * The learner app reads the same JSON — keep
 * frontend-learner-dashboard-app/.../slide-material/spreadsheet/spreadsheet-slide-utils.ts
 * in step with this file.
 */
import { parseA1, parseRange } from '@/components/cbe/a1';
import type { CbeSheet, CbeSheetTab } from '@/components/cbe/types';

export const SPREADSHEET_DOC_TYPE = 'SPREADSHEET' as const;
export const SPREADSHEET_DATA_VERSION = 1 as const;

/** Largest workbook accepted for upload. */
export const SPREADSHEET_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Most filled cells across all tabs (the grid renders every cell). */
export const SPREADSHEET_MAX_CELLS = 20_000;
/** Most rows × columns one tab may span (blank cells inside the range render too). */
export const SPREADSHEET_MAX_GRID_CELLS_PER_TAB = 100_000;
/** Most worksheet tabs. */
export const SPREADSHEET_MAX_TABS = 30;
/** Largest stored JSON (it travels with the chapter's slide list). */
export const SPREADSHEET_MAX_JSON_CHARS = 1_200_000;

export const SPREADSHEET_ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;
export const SPREADSHEET_ACCEPTED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
] as const;

export type SpreadsheetSlideData = {
    version: typeof SPREADSHEET_DATA_VERSION;
    /** The read-only grid shown to learners (all worksheet tabs). */
    sheet: CbeSheet;
    /** Media file id of the original upload, or null when it was not kept. */
    file_id: string | null;
    /** Original file name, e.g. "Trial balance.xlsx". */
    file_name: string;
    /** Original file size in bytes (display only). */
    file_size: number | null;
    /** Learners see a Download button for the original file. Absent = true. */
    allow_download: boolean;
};

export type SpreadsheetLimitError =
    | { code: 'empty' }
    | { code: 'fileTooLarge'; size: number; max: number }
    | { code: 'unsupportedType' }
    | { code: 'tooManyTabs'; count: number; max: number }
    | { code: 'tooManyCells'; count: number; max: number }
    | { code: 'tabTooLarge'; tab: string; count: number; max: number }
    | { code: 'dataTooLarge'; size: number; max: number };

export type SpreadsheetSheetStats = {
    tabs: number;
    cells: number;
    /** rows × columns of the largest tab's used range */
    largestTabArea: number;
    largestTabName: string;
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);

/** True when the file name or type looks like a workbook this slide accepts. */
export function isAcceptedSpreadsheetFile(file: { name: string; type?: string }): boolean {
    const name = (file.name || '').toLowerCase();
    if (SPREADSHEET_ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
    return (SPREADSHEET_ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type ?? '');
}

/** Size check before the file is read at all. */
export function checkSpreadsheetFile(file: {
    name: string;
    type?: string;
    size: number;
}): SpreadsheetLimitError | null {
    if (!isAcceptedSpreadsheetFile(file)) return { code: 'unsupportedType' };
    if (file.size <= 0) return { code: 'empty' };
    if (file.size > SPREADSHEET_MAX_FILE_BYTES) {
        return { code: 'fileTooLarge', size: file.size, max: SPREADSHEET_MAX_FILE_BYTES };
    }
    return null;
}

/** Rows × columns a tab spans, measured the way the read-only grid lays it out. */
export function tabGridArea(tab: CbeSheetTab): number {
    let rows = 0;
    let cols = 0;
    for (const ref of Object.keys(tab.cells ?? {})) {
        const p = parseA1(ref);
        if (!p) continue;
        rows = Math.max(rows, p.r + 1);
        cols = Math.max(cols, p.c + 1);
    }
    for (const m of tab.merges ?? []) {
        const r = parseRange(m);
        if (!r) continue;
        rows = Math.max(rows, r.e.r + 1);
        cols = Math.max(cols, r.e.c + 1);
    }
    return rows * cols;
}

export function sheetStats(sheet: CbeSheet): SpreadsheetSheetStats {
    let cells = 0;
    let largestTabArea = 0;
    let largestTabName = '';
    for (const tab of sheet.sheets ?? []) {
        cells += Object.keys(tab.cells ?? {}).length;
        const area = tabGridArea(tab);
        if (area > largestTabArea) {
            largestTabArea = area;
            largestTabName = tab.name;
        }
    }
    return { tabs: sheet.sheets?.length ?? 0, cells, largestTabArea, largestTabName };
}

/** Limits on the converted grid. Returns the first limit broken, or null. */
export function checkSpreadsheetSheet(sheet: CbeSheet): SpreadsheetLimitError | null {
    const stats = sheetStats(sheet);
    if (stats.cells === 0) return { code: 'empty' };
    if (stats.tabs > SPREADSHEET_MAX_TABS) {
        return { code: 'tooManyTabs', count: stats.tabs, max: SPREADSHEET_MAX_TABS };
    }
    if (stats.cells > SPREADSHEET_MAX_CELLS) {
        return { code: 'tooManyCells', count: stats.cells, max: SPREADSHEET_MAX_CELLS };
    }
    if (stats.largestTabArea > SPREADSHEET_MAX_GRID_CELLS_PER_TAB) {
        return {
            code: 'tabTooLarge',
            tab: stats.largestTabName,
            count: stats.largestTabArea,
            max: SPREADSHEET_MAX_GRID_CELLS_PER_TAB,
        };
    }
    return null;
}

/** Limit on the JSON that will be stored. */
export function checkSpreadsheetJson(json: string): SpreadsheetLimitError | null {
    if (json.length > SPREADSHEET_MAX_JSON_CHARS) {
        return { code: 'dataTooLarge', size: json.length, max: SPREADSHEET_MAX_JSON_CHARS };
    }
    return null;
}

export function buildSpreadsheetSlideData(input: {
    sheet: CbeSheet;
    fileId: string | null;
    fileName: string;
    fileSize: number | null;
    allowDownload?: boolean;
}): SpreadsheetSlideData {
    return {
        version: SPREADSHEET_DATA_VERSION,
        sheet: input.sheet,
        file_id: input.fileId || null,
        file_name: input.fileName,
        file_size: input.fileSize ?? null,
        allow_download: input.allowDownload ?? true,
    };
}

export function serializeSpreadsheetData(data: SpreadsheetSlideData): string {
    return JSON.stringify({
        version: SPREADSHEET_DATA_VERSION,
        sheet: data.sheet,
        file_id: data.file_id || null,
        file_name: data.file_name || '',
        file_size: data.file_size ?? null,
        allow_download: data.allow_download !== false,
    });
}

/**
 * Reads a stored spreadsheet slide (string or already-parsed object). Returns
 * null for anything that is not a spreadsheet payload with at least one tab.
 */
export function parseSpreadsheetData(raw: unknown): SpreadsheetSlideData | null {
    let obj: unknown = raw;
    if (typeof raw === 'string') {
        if (!raw.trim()) return null;
        try {
            obj = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!isRecord(obj)) return null;
    const sheet = obj.sheet;
    if (!isRecord(sheet) || !Array.isArray(sheet.sheets) || sheet.sheets.length === 0) return null;
    const tabs = (sheet.sheets as unknown[]).filter(
        (t): t is CbeSheetTab => isRecord(t) && typeof t.name === 'string' && isRecord(t.cells)
    );
    if (!tabs.length) return null;
    return {
        version: SPREADSHEET_DATA_VERSION,
        sheet: { sheets: tabs },
        file_id: typeof obj.file_id === 'string' && obj.file_id ? obj.file_id : null,
        file_name: typeof obj.file_name === 'string' ? obj.file_name : '',
        file_size: typeof obj.file_size === 'number' ? obj.file_size : null,
        allow_download: obj.allow_download !== false,
    };
}

/** "Budget 2026.xlsx" -> "Budget 2026" (slide title from the file name). */
export function spreadsheetTitleFromFileName(name: string): string {
    return (name || '').replace(/\.(xlsx|xls|csv)$/i, '').trim();
}
