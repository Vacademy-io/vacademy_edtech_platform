import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { xlsxToCbeSheet } from '@/components/cbe/xlsx-import';
import type { CbeSheet } from '@/components/cbe/types';
import { finaliseSpreadsheet, SpreadsheetImportError } from './spreadsheet-import';
import {
    buildSpreadsheetSlideData,
    checkSpreadsheetFile,
    checkSpreadsheetJson,
    checkSpreadsheetSheet,
    isAcceptedSpreadsheetFile,
    parseSpreadsheetData,
    serializeSpreadsheetData,
    sheetStats,
    spreadsheetTitleFromFileName,
    SPREADSHEET_MAX_CELLS,
    SPREADSHEET_MAX_FILE_BYTES,
    SPREADSHEET_MAX_GRID_CELLS_PER_TAB,
    SPREADSHEET_MAX_JSON_CHARS,
    SPREADSHEET_MAX_TABS,
} from './spreadsheet-slide-data';

/** A two-tab workbook with a formula, a merge and a number format, as .xlsx bytes. */
function workbookBytes(): Uint8Array {
    const wb = XLSX.utils.book_new();
    const tb = XLSX.utils.aoa_to_sheet([
        ['Trial balance'],
        ['Account', 'Debit', 'Credit'],
        ['Cash', 1200, null],
        ['Sales', null, 1200],
        ['Total', 1200, 1200],
    ]);
    tb.B5 = { t: 'n', v: 1200, f: 'SUM(B3:B4)', z: '#,##0' };
    tb['!merges'] = [XLSX.utils.decode_range('A1:C1')];
    XLSX.utils.book_append_sheet(wb, tb, 'TB');
    XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([['Note'], ['Cash in hand']]),
        'Notes'
    );
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

/** A sheet with `n` filled cells in one column. */
function columnSheet(n: number, name = 'Big'): CbeSheet {
    const cells: Record<string, { v: number }> = {};
    for (let i = 1; i <= n; i += 1) cells[`A${i}`] = { v: i };
    return { sheets: [{ name, cells }] };
}

describe('spreadsheet slide data — round trip', () => {
    it('keeps every tab, value, formula and merge through convert → serialize → parse', () => {
        const sheet = xlsxToCbeSheet(workbookBytes());
        const { data, json } = finaliseSpreadsheet(sheet, { name: 'TB 2026.xlsx', size: 4096 });

        expect(data.file_name).toBe('TB 2026.xlsx');
        expect(data.file_id).toBeNull();
        expect(data.allow_download).toBe(true);

        const withFile = serializeSpreadsheetData({ ...data, file_id: 'file-123' });
        const back = parseSpreadsheetData(withFile);
        expect(back).not.toBeNull();
        expect(back!.file_id).toBe('file-123');
        expect(back!.file_size).toBe(4096);
        expect(back!.sheet.sheets.map((t) => t.name)).toEqual(['TB', 'Notes']);
        const tb = back!.sheet.sheets[0]!;
        expect(tb.cells.A3?.v).toBe('Cash');
        expect(tb.cells.B5).toMatchObject({ v: 1200, f: '=SUM(B3:B4)' });
        expect(tb.merges).toEqual(['A1:C1']);
        expect(back!.sheet.sheets[1]!.cells.A2?.v).toBe('Cash in hand');

        // Serialising the parsed copy again gives the same stored string.
        expect(serializeSpreadsheetData(back!)).toBe(withFile);
        // The stored JSON parses exactly like the in-memory object.
        expect(parseSpreadsheetData(JSON.parse(json))).toEqual(parseSpreadsheetData(json));
    });

    it('reads a CSV upload as one tab', () => {
        const csv = new TextEncoder().encode('Item,Amount\nRent,500\nFood,250\n');
        const { data } = finaliseSpreadsheet(xlsxToCbeSheet(csv), { name: 'budget.csv', size: 33 });
        expect(data.sheet.sheets).toHaveLength(1);
        const cells = data.sheet.sheets[0]!.cells;
        expect(cells.A2?.v).toBe('Rent');
        expect(cells.B2?.v).toBe(500);
    });

    it('treats a missing allow_download as on, and false as off', () => {
        const base = buildSpreadsheetSlideData({
            sheet: columnSheet(2),
            fileId: 'f',
            fileName: 'a.xlsx',
            fileSize: 10,
        });
        const raw = JSON.parse(serializeSpreadsheetData(base));
        delete raw.allow_download;
        expect(parseSpreadsheetData(raw)!.allow_download).toBe(true);
        expect(
            parseSpreadsheetData(serializeSpreadsheetData({ ...base, allow_download: false }))!
                .allow_download
        ).toBe(false);
    });

    it('returns null for anything that is not a spreadsheet payload', () => {
        expect(parseSpreadsheetData('')).toBeNull();
        expect(parseSpreadsheetData('not json')).toBeNull();
        expect(parseSpreadsheetData('<p>hello</p>')).toBeNull();
        expect(parseSpreadsheetData('{}')).toBeNull();
        expect(parseSpreadsheetData({ sheet: { sheets: [] } })).toBeNull();
        expect(parseSpreadsheetData({ sheet: { sheets: [{ name: 1, cells: {} }] } })).toBeNull();
        expect(parseSpreadsheetData(null)).toBeNull();
    });
});

describe('spreadsheet slide data — limits', () => {
    it('accepts .xlsx / .xls / .csv and rejects other files', () => {
        expect(isAcceptedSpreadsheetFile({ name: 'a.XLSX' })).toBe(true);
        expect(isAcceptedSpreadsheetFile({ name: 'a.xls' })).toBe(true);
        expect(isAcceptedSpreadsheetFile({ name: 'a.csv' })).toBe(true);
        expect(isAcceptedSpreadsheetFile({ name: 'a.docx', type: 'application/msword' })).toBe(
            false
        );
        expect(checkSpreadsheetFile({ name: 'a.pdf', size: 10 })).toEqual({
            code: 'unsupportedType',
        });
    });

    it('rejects files over the size limit and empty files', () => {
        expect(
            checkSpreadsheetFile({ name: 'a.xlsx', size: SPREADSHEET_MAX_FILE_BYTES })
        ).toBeNull();
        expect(
            checkSpreadsheetFile({ name: 'a.xlsx', size: SPREADSHEET_MAX_FILE_BYTES + 1 })
        ).toEqual({
            code: 'fileTooLarge',
            size: SPREADSHEET_MAX_FILE_BYTES + 1,
            max: SPREADSHEET_MAX_FILE_BYTES,
        });
        expect(checkSpreadsheetFile({ name: 'a.xlsx', size: 0 })).toEqual({ code: 'empty' });
    });

    it('allows exactly the cell limit and rejects one more', () => {
        expect(checkSpreadsheetSheet(columnSheet(SPREADSHEET_MAX_CELLS))).toBeNull();
        expect(checkSpreadsheetSheet(columnSheet(SPREADSHEET_MAX_CELLS + 1))).toEqual({
            code: 'tooManyCells',
            count: SPREADSHEET_MAX_CELLS + 1,
            max: SPREADSHEET_MAX_CELLS,
        });
    });

    it('rejects a tab whose used range is too large even with few cells', () => {
        const sheet: CbeSheet = {
            sheets: [{ name: 'Stray', cells: { A1: { v: 'top' }, Z5000: { v: 'far away' } } }],
        };
        expect(sheetStats(sheet).largestTabArea).toBe(26 * 5000);
        expect(checkSpreadsheetSheet(sheet)).toEqual({
            code: 'tabTooLarge',
            tab: 'Stray',
            count: 26 * 5000,
            max: SPREADSHEET_MAX_GRID_CELLS_PER_TAB,
        });
    });

    it('rejects too many tabs and a workbook with no filled cells', () => {
        const many: CbeSheet = {
            sheets: Array.from({ length: SPREADSHEET_MAX_TABS + 1 }, (_, i) => ({
                name: `S${i}`,
                cells: { A1: { v: i } },
            })),
        };
        expect(checkSpreadsheetSheet(many)?.code).toBe('tooManyTabs');
        expect(checkSpreadsheetSheet({ sheets: [{ name: 'Empty', cells: {} }] })).toEqual({
            code: 'empty',
        });
    });

    it('rejects stored JSON over the size limit', () => {
        expect(checkSpreadsheetJson('x'.repeat(SPREADSHEET_MAX_JSON_CHARS))).toBeNull();
        expect(checkSpreadsheetJson('x'.repeat(SPREADSHEET_MAX_JSON_CHARS + 1))?.code).toBe(
            'dataTooLarge'
        );
    });

    it('finaliseSpreadsheet throws a typed error carrying the broken limit', () => {
        let caught: unknown;
        try {
            finaliseSpreadsheet(columnSheet(SPREADSHEET_MAX_CELLS + 5), {
                name: 'x.xlsx',
                size: 1,
            });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(SpreadsheetImportError);
        expect((caught as SpreadsheetImportError).limit.code).toBe('tooManyCells');
    });

    it('a sheet at the cell limit still fits the stored JSON limit', () => {
        const wide: CbeSheet = { sheets: [{ name: 'Wide', cells: {} }] };
        // 200 rows × 100 columns of realistic money cells with a number format.
        const cols = 100;
        for (let r = 1; r <= SPREADSHEET_MAX_CELLS / cols; r += 1) {
            for (let c = 0; c < cols; c += 1) {
                const ref = `${XLSX.utils.encode_col(c)}${r}`;
                wide.sheets[0]!.cells[ref] = { v: 123456.78, s: { nf: '#,##0.00' } };
            }
        }
        expect(() => finaliseSpreadsheet(wide, { name: 'w.xlsx', size: 1 })).not.toThrow();
    });
});

describe('spreadsheetTitleFromFileName', () => {
    it('drops the workbook extension', () => {
        expect(spreadsheetTitleFromFileName('Trial balance.xlsx')).toBe('Trial balance');
        expect(spreadsheetTitleFromFileName('data.CSV')).toBe('data');
        expect(spreadsheetTitleFromFileName('notes.v2.xls')).toBe('notes.v2');
    });
});
