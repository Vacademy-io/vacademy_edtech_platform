import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { xlsxToCbeSheet } from '@/components/cbe/xlsx-import';
import type { CbeSheet } from '@/components/cbe/types';
import {
    finaliseSpreadsheet,
    SpreadsheetImportError,
    SpreadsheetUploadError,
    spreadsheetGridFile,
    uploadConvertedSpreadsheet,
} from './spreadsheet-import';
import {
    buildSpreadsheetSlideData,
    checkSpreadsheetFile,
    checkSpreadsheetJson,
    checkSpreadsheetSheet,
    isAcceptedSpreadsheetFile,
    parseSpreadsheetData,
    parseSpreadsheetGrid,
    serializeSpreadsheetData,
    serializeSpreadsheetGrid,
    sheetStats,
    spreadsheetTitleFromFileName,
    SPREADSHEET_DATA_VERSION,
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
    it('keeps every tab, value, formula and merge in the grid file, and only metadata in the slide', async () => {
        const sheet = xlsxToCbeSheet(workbookBytes());
        const converted = finaliseSpreadsheet(sheet, { name: 'TB 2026.xlsx', size: 4096 });
        expect(converted.fileName).toBe('TB 2026.xlsx');
        expect(converted.sheetNames).toEqual(['TB', 'Notes']);

        // The grid file holds the whole grid.
        const grid = parseSpreadsheetGrid(converted.gridJson);
        expect(grid).not.toBeNull();
        expect(grid!.sheets.map((t) => t.name)).toEqual(['TB', 'Notes']);
        const tb = grid!.sheets[0]!;
        expect(tb.cells.A3?.v).toBe('Cash');
        expect(tb.cells.B5).toMatchObject({ v: 1200, f: '=SUM(B3:B4)' });
        expect(tb.merges).toEqual(['A1:C1']);
        expect(grid!.sheets[1]!.cells.A2?.v).toBe('Cash in hand');
        expect(serializeSpreadsheetGrid(grid!)).toBe(converted.gridJson);

        // Both files go through the upload helper; the slide keeps their ids.
        const uploaded: File[] = [];
        const data = await uploadConvertedSpreadsheet({
            original: new File(['xlsx'], 'TB 2026.xlsx'),
            converted,
            upload: async (file) => {
                uploaded.push(file);
                return file.name.endsWith('.json') ? 'grid-456' : 'file-123';
            },
        });
        expect(uploaded.map((f) => f.name).sort()).toEqual(['TB 2026.grid.json', 'TB 2026.xlsx']);
        const gridUpload = uploaded.find((f) => f.name.endsWith('.json'))!;
        expect(gridUpload.type).toBe('application/json');
        expect(await gridUpload.text()).toBe(converted.gridJson);

        const json = serializeSpreadsheetData(data);
        expect(JSON.parse(json)).toEqual({
            version: SPREADSHEET_DATA_VERSION,
            grid_file_id: 'grid-456',
            file_id: 'file-123',
            file_name: 'TB 2026.xlsx',
            file_size: 4096,
            allow_download: true,
            sheet_names: ['TB', 'Notes'],
            cell_count: sheetStats(sheet).cells,
        });
        const back = parseSpreadsheetData(json);
        expect(back).toEqual(data);
        expect(back!.sheet).toBeUndefined();
        // Serialising the parsed copy again gives the same stored string.
        expect(serializeSpreadsheetData(back!)).toBe(json);
        // The stored JSON parses exactly like the in-memory object.
        expect(parseSpreadsheetData(JSON.parse(json))).toEqual(back);
    });

    it('keeps the slide data small even for a grid at the cell limit', () => {
        const big = columnSheet(SPREADSHEET_MAX_CELLS);
        const converted = finaliseSpreadsheet(big, { name: 'big.xlsx', size: 1 });
        const json = serializeSpreadsheetData(
            buildSpreadsheetSlideData({
                gridFileId: 'g',
                fileId: 'f',
                fileName: converted.fileName,
                fileSize: 1,
                sheetNames: converted.sheetNames,
                cellCount: converted.cellCount,
            })
        );
        expect(converted.gridJson.length).toBeGreaterThan(100_000);
        expect(json.length).toBeLessThan(500);
    });

    it('fails the import when either upload fails', async () => {
        const converted = finaliseSpreadsheet(columnSheet(2), { name: 'a.xlsx', size: 10 });
        const original = new File(['x'], 'a.xlsx');
        await expect(
            uploadConvertedSpreadsheet({
                original,
                converted,
                upload: async (file) => (file.name.endsWith('.json') ? undefined : 'f'),
            })
        ).rejects.toBeInstanceOf(SpreadsheetUploadError);
        await expect(
            uploadConvertedSpreadsheet({
                original,
                converted,
                upload: async (file) => {
                    if (file.name.endsWith('.xlsx')) throw new Error('network');
                    return 'g';
                },
            })
        ).rejects.toBeInstanceOf(SpreadsheetUploadError);
    });

    it('still reads a legacy (version 1) slide with the grid inline', () => {
        const legacy = {
            version: 1,
            sheet: columnSheet(3, 'Old'),
            file_id: 'f',
            file_name: 'old.xlsx',
            file_size: 10,
            allow_download: false,
        };
        const data = parseSpreadsheetData(JSON.stringify(legacy));
        expect(data).not.toBeNull();
        expect(data!.grid_file_id).toBeNull();
        expect(data!.sheet!.sheets[0]!.cells.A3?.v).toBe(3);
        expect(data!.sheet_names).toEqual(['Old']);
        expect(data!.cell_count).toBe(3);
        expect(data!.allow_download).toBe(false);
        // Re-saving a legacy slide keeps its inline grid (it has no grid file).
        expect(parseSpreadsheetData(serializeSpreadsheetData(data!))!.sheet).toEqual(data!.sheet);
    });

    it('reads a CSV upload as one tab', () => {
        const csv = new TextEncoder().encode('Item,Amount\nRent,500\nFood,250\n');
        const converted = finaliseSpreadsheet(xlsxToCbeSheet(csv), {
            name: 'budget.csv',
            size: 33,
        });
        expect(converted.sheet.sheets).toHaveLength(1);
        const cells = converted.sheet.sheets[0]!.cells;
        expect(cells.A2?.v).toBe('Rent');
        expect(cells.B2?.v).toBe(500);
        expect(spreadsheetGridFile(converted).name).toBe('budget.grid.json');
    });

    it('treats a missing allow_download as on, and false as off', () => {
        const base = buildSpreadsheetSlideData({
            gridFileId: 'g',
            fileId: 'f',
            fileName: 'a.xlsx',
            fileSize: 10,
            sheetNames: ['Big'],
            cellCount: 2,
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
        expect(parseSpreadsheetData({ grid_file_id: '' })).toBeNull();
        expect(parseSpreadsheetData({ sheet: { sheets: [] } })).toBeNull();
        expect(parseSpreadsheetData({ sheet: { sheets: [{ name: 1, cells: {} }] } })).toBeNull();
        expect(parseSpreadsheetData(null)).toBeNull();
        expect(parseSpreadsheetGrid('{"sheets":[]}')).toBeNull();
        expect(parseSpreadsheetGrid('nope')).toBeNull();
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

    it('a sheet at the cell limit still fits the grid file limit', () => {
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
