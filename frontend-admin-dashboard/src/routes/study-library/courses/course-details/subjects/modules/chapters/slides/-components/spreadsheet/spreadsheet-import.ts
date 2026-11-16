/**
 * Browser-side conversion of an uploaded workbook into spreadsheet slide data.
 * SheetJS is loaded lazily (through the CBE importer) so it stays out of the
 * main bundle.
 */
import type { CbeSheet } from '@/components/cbe/types';
import {
    buildSpreadsheetSlideData,
    checkSpreadsheetFile,
    checkSpreadsheetJson,
    checkSpreadsheetSheet,
    serializeSpreadsheetGrid,
    sheetStats,
    spreadsheetTitleFromFileName,
    type SpreadsheetLimitError,
    type SpreadsheetSlideData,
} from './spreadsheet-slide-data';

export class SpreadsheetImportError extends Error {
    readonly limit: SpreadsheetLimitError | { code: 'unreadable' };

    constructor(limit: SpreadsheetLimitError | { code: 'unreadable' }) {
        super(limit.code);
        this.name = 'SpreadsheetImportError';
        this.limit = limit;
    }
}

/** One of the two uploads (original workbook or grid JSON) did not complete. */
export class SpreadsheetUploadError extends Error {
    constructor() {
        super('upload');
        this.name = 'SpreadsheetUploadError';
    }
}

export type ConvertedSpreadsheet = {
    /** The converted grid (kept in memory for the preview; stored as its own file). */
    sheet: CbeSheet;
    /** Contents of the grid file, already checked against the size limit. */
    gridJson: string;
    fileName: string;
    fileSize: number;
    sheetNames: string[];
    cellCount: number;
};

/**
 * Converts an already-parsed grid and checks every limit.
 * Pure: the unit tests drive it with sheets built in memory.
 */
export function finaliseSpreadsheet(
    sheet: CbeSheet,
    file: { name: string; size: number }
): ConvertedSpreadsheet {
    const sheetLimit = checkSpreadsheetSheet(sheet);
    if (sheetLimit) throw new SpreadsheetImportError(sheetLimit);
    const gridJson = serializeSpreadsheetGrid(sheet);
    const jsonLimit = checkSpreadsheetJson(gridJson);
    if (jsonLimit) throw new SpreadsheetImportError(jsonLimit);
    return {
        sheet,
        gridJson,
        fileName: file.name,
        fileSize: file.size,
        sheetNames: sheet.sheets.map((t) => t.name),
        cellCount: sheetStats(sheet).cells,
    };
}

/** Reads an .xlsx / .xls / .csv File into a checked grid (nothing uploaded yet). */
export async function convertSpreadsheetFile(file: File): Promise<ConvertedSpreadsheet> {
    const fileLimit = checkSpreadsheetFile(file);
    if (fileLimit) throw new SpreadsheetImportError(fileLimit);
    let sheet: CbeSheet;
    try {
        const { readXlsxFile } = await import('@/components/cbe/xlsx-import');
        sheet = await readXlsxFile(file);
    } catch {
        throw new SpreadsheetImportError({ code: 'unreadable' });
    }
    return finaliseSpreadsheet(sheet, file);
}

/** The grid file uploaded next to the workbook, e.g. "Trial balance.grid.json". */
export function spreadsheetGridFile(converted: ConvertedSpreadsheet): File {
    const base = spreadsheetTitleFromFileName(converted.fileName) || 'spreadsheet';
    return new File([converted.gridJson], `${base}.grid.json`, { type: 'application/json' });
}

/**
 * Uploads the original workbook and the grid JSON (both through `upload`, the
 * media upload helper) and returns the slide data to store. Throws
 * SpreadsheetUploadError when either upload fails.
 */
export async function uploadConvertedSpreadsheet(input: {
    original: File;
    converted: ConvertedSpreadsheet;
    upload: (file: File) => Promise<string | undefined>;
    allowDownload?: boolean;
}): Promise<SpreadsheetSlideData> {
    const safeUpload = (file: File) => input.upload(file).catch(() => undefined);
    const [fileId, gridFileId] = await Promise.all([
        safeUpload(input.original),
        safeUpload(spreadsheetGridFile(input.converted)),
    ]);
    if (!fileId || !gridFileId) throw new SpreadsheetUploadError();
    return buildSpreadsheetSlideData({
        gridFileId,
        fileId,
        fileName: input.converted.fileName,
        fileSize: input.converted.fileSize,
        sheetNames: input.converted.sheetNames,
        cellCount: input.converted.cellCount,
        allowDownload: input.allowDownload,
    });
}
