/**
 * Spreadsheet (Excel) slide — storage format and limits.
 *
 * A spreadsheet slide is a DOCUMENT slide with `document_slide.type =
 * "SPREADSHEET"`. Its `data` / `published_data` hold only small metadata (see
 * SpreadsheetSlideData), so drafts, publish, copy, move and drip work exactly
 * as for any other document slide and no schema change is needed.
 *
 * The grid itself (the CBE sheet model, `@/components/cbe` CbeSheet, converted
 * in the browser from the uploaded workbook) is stored as its own JSON media
 * file (`grid_file_id`) and fetched when the slide opens. It must NOT go into
 * the slide data: every chapter / course slide-list query returns that column
 * and the server caches it, so a large inline grid would ride along with every
 * course open. The original workbook is kept in media storage too
 * (`file_id`) so learners can download it.
 *
 * The learner app reads the same JSON — keep
 * frontend-learner-dashboard-app/.../slide-material/spreadsheet/spreadsheet-slide-utils.ts
 * in step with this file.
 */
import { parseA1, parseRange } from '@/components/cbe/a1';
import type { CbeSheet, CbeSheetTab } from '@/components/cbe/types';

export const SPREADSHEET_DOC_TYPE = 'SPREADSHEET' as const;
/** 1 = grid inline in the slide data (never shipped); 2 = grid in its own file. */
export const SPREADSHEET_DATA_VERSION = 2 as const;
/** Format version of the separate grid JSON file. */
export const SPREADSHEET_GRID_VERSION = 1 as const;

/** Largest workbook accepted for upload. */
export const SPREADSHEET_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Most filled cells across all tabs (the grid renders every cell). */
export const SPREADSHEET_MAX_CELLS = 20_000;
/** Most rows × columns one tab may span (blank cells inside the range render too). */
export const SPREADSHEET_MAX_GRID_CELLS_PER_TAB = 100_000;
/** Most worksheet tabs. */
export const SPREADSHEET_MAX_TABS = 30;
/** Largest grid JSON file (learners download it when the slide opens). */
export const SPREADSHEET_MAX_JSON_CHARS = 1_200_000;

export const SPREADSHEET_ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;
export const SPREADSHEET_ACCEPTED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
] as const;

/** What `document_slide.data` / `published_data` hold (small: no grid). */
export type SpreadsheetSlideData = {
    version: typeof SPREADSHEET_DATA_VERSION;
    /** Media file id of the grid JSON (all worksheet tabs), or null for a legacy inline grid. */
    grid_file_id: string | null;
    /** Media file id of the original upload, or null when it was not kept. */
    file_id: string | null;
    /** Original file name, e.g. "Trial balance.xlsx". */
    file_name: string;
    /** Original file size in bytes (display only). */
    file_size: number | null;
    /** Learners see a Download button for the original file. Absent = true. */
    allow_download: boolean;
    /** Worksheet tab names, in order (shown before the grid loads, and to the AI tutor). */
    sheet_names: string[];
    /** Filled cells across all tabs. */
    cell_count: number;
    /**
     * Legacy (version 1, never shipped): the grid stored inline. Read so old
     * local test data still renders; never written when `grid_file_id` is set.
     */
    sheet?: CbeSheet;
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

/** Limit on the grid JSON file. */
export function checkSpreadsheetJson(json: string): SpreadsheetLimitError | null {
    if (json.length > SPREADSHEET_MAX_JSON_CHARS) {
        return { code: 'dataTooLarge', size: json.length, max: SPREADSHEET_MAX_JSON_CHARS };
    }
    return null;
}

/** The grid file's contents: `{ version, sheets }`. */
export function serializeSpreadsheetGrid(sheet: CbeSheet): string {
    return JSON.stringify({ version: SPREADSHEET_GRID_VERSION, sheets: sheet.sheets });
}

/**
 * Reads a grid: the grid file (`{ version, sheets }`), a bare CbeSheet, or a
 * legacy slide payload (`{ sheet: { sheets } }`). Null when there is no
 * readable tab.
 */
export function parseSpreadsheetGrid(raw: unknown): CbeSheet | null {
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
    if (!Array.isArray(obj.sheets) && isRecord(obj.sheet)) obj = obj.sheet;
    if (!isRecord(obj) || !Array.isArray(obj.sheets)) return null;
    const tabs = (obj.sheets as unknown[]).filter(
        (t): t is CbeSheetTab => isRecord(t) && typeof t.name === 'string' && isRecord(t.cells)
    );
    return tabs.length ? { sheets: tabs } : null;
}

export function buildSpreadsheetSlideData(input: {
    gridFileId: string | null;
    fileId: string | null;
    fileName: string;
    fileSize: number | null;
    sheetNames: string[];
    cellCount: number;
    allowDownload?: boolean;
}): SpreadsheetSlideData {
    return {
        version: SPREADSHEET_DATA_VERSION,
        grid_file_id: input.gridFileId || null,
        file_id: input.fileId || null,
        file_name: input.fileName,
        file_size: input.fileSize ?? null,
        allow_download: input.allowDownload ?? true,
        sheet_names: [...input.sheetNames],
        cell_count: input.cellCount,
    };
}

/** The slide data JSON. The grid is written inline only for a legacy slide with no grid file. */
export function serializeSpreadsheetData(data: SpreadsheetSlideData): string {
    const gridFileId = data.grid_file_id || null;
    return JSON.stringify({
        version: SPREADSHEET_DATA_VERSION,
        grid_file_id: gridFileId,
        file_id: data.file_id || null,
        file_name: data.file_name || '',
        file_size: data.file_size ?? null,
        allow_download: data.allow_download !== false,
        sheet_names: data.sheet_names ?? [],
        cell_count: data.cell_count ?? 0,
        ...(!gridFileId && data.sheet ? { sheet: data.sheet } : {}),
    });
}

/**
 * Reads a stored spreadsheet slide (string or already-parsed object). Returns
 * null for anything that is neither a grid-file payload nor a legacy payload
 * with an inline grid.
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
    const gridFileId =
        typeof obj.grid_file_id === 'string' && obj.grid_file_id ? obj.grid_file_id : null;
    const inline = gridFileId ? null : parseSpreadsheetGrid(obj.sheet ?? null);
    if (!gridFileId && !inline) return null;
    const storedNames = Array.isArray(obj.sheet_names)
        ? (obj.sheet_names as unknown[]).filter((n): n is string => typeof n === 'string')
        : [];
    const data: SpreadsheetSlideData = {
        version: SPREADSHEET_DATA_VERSION,
        grid_file_id: gridFileId,
        file_id: typeof obj.file_id === 'string' && obj.file_id ? obj.file_id : null,
        file_name: typeof obj.file_name === 'string' ? obj.file_name : '',
        file_size: typeof obj.file_size === 'number' ? obj.file_size : null,
        allow_download: obj.allow_download !== false,
        sheet_names: inline && !storedNames.length ? inline.sheets.map((t) => t.name) : storedNames,
        cell_count:
            typeof obj.cell_count === 'number' && obj.cell_count >= 0
                ? obj.cell_count
                : inline
                  ? sheetStats(inline).cells
                  : 0,
    };
    if (inline) data.sheet = inline;
    return data;
}

/** "Budget 2026.xlsx" -> "Budget 2026" (slide title from the file name). */
export function spreadsheetTitleFromFileName(name: string): string {
    return (name || '').replace(/\.(xlsx|xls|csv)$/i, '').trim();
}
