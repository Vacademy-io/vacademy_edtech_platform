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
    serializeSpreadsheetData,
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

export type ConvertedSpreadsheet = {
    data: SpreadsheetSlideData;
    json: string;
};

/**
 * Converts an already-parsed grid into slide data and checks every limit.
 * Pure: the unit tests drive it with sheets built in memory.
 */
export function finaliseSpreadsheet(
    sheet: CbeSheet,
    file: { name: string; size: number },
    fileId: string | null = null
): ConvertedSpreadsheet {
    const sheetLimit = checkSpreadsheetSheet(sheet);
    if (sheetLimit) throw new SpreadsheetImportError(sheetLimit);
    const data = buildSpreadsheetSlideData({
        sheet,
        fileId,
        fileName: file.name,
        fileSize: file.size,
    });
    const json = serializeSpreadsheetData(data);
    const jsonLimit = checkSpreadsheetJson(json);
    if (jsonLimit) throw new SpreadsheetImportError(jsonLimit);
    return { data, json };
}

/** Reads an .xlsx / .xls / .csv File into slide data (file id filled in after upload). */
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
