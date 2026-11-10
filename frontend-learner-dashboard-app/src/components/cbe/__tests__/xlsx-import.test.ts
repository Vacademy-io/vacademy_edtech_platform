import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { cbeSheetSignature, cbeToFortune, fortuneToCbe } from "../fortune-adapter";
import { extractMarkingScheme, workbookToCbeSheet, xlsxToCbeSheet } from "../xlsx-import";

const NF = "#,##0;\\(#,##0\\);\\-";
const FIXTURE = path.resolve(__dirname, "fixtures/cbe-mini-solution.xlsx");
/** Optional: point at a real solution workbook to run the real-file check. */
const REAL = process.env.CBE_REAL_XLSX ?? "";

/** Builds a solution workbook in memory with SheetJS and returns its bytes. */
function buildWorkbookBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const sfp = XLSX.utils.aoa_to_sheet([
    ["Solution – part (a)"],
    [],
    ["Line", "$000", "Working", "Mark"],
    ["Revenue", 1000, "per TB", 1],
    ["Cost of sales", -400, null, 1.5],
    ["Gross profit", 600, "W1", 2],
    ["Heading only"],
    ["Total marks", null, null, 4.5],
  ]);
  // formulas with cached values
  sfp.B6 = { t: "n", v: 600, f: "B4+B5", z: NF };
  sfp.B5 = { t: "n", v: -400, z: NF };
  sfp.D8 = { t: "n", v: 4.5, f: "SUM(D4:D7)" };
  sfp["!merges"] = [XLSX.utils.decode_range("A1:D1")];
  XLSX.utils.book_append_sheet(wb, sfp, "P&L");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Workings"], ["W1", 600]]), "Workings");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

describe("xlsxToCbeSheet", () => {
  it("imports the committed fixture: all tabs, formulas with '=', cached values, formats", () => {
    const sheet = xlsxToCbeSheet(readFileSync(FIXTURE));
    expect(sheet.sheets.map((t) => t.name)).toEqual(["Consolidated SFP", "Workings"]);
    const sfp = sheet.sheets[0]!;
    expect(sfp.cells.B6).toEqual({ v: 3200, f: "=Workings!B5", s: { nf: NF } });
    expect(sfp.cells.B10).toEqual({ v: -900, f: "=-900", s: { nf: NF } });
    expect(sfp.cells.D4).toEqual({ v: "Marks" });
    expect(sfp.merges).toEqual(["A1:D1"]);
    expect(sfp.colWidths).toEqual({ A: 276, B: 84, C: 336, D: 48 });
    expect(sfp.rowCount).toBeGreaterThanOrEqual(40);
    expect(sheet.sheets[1]!.cells.B5).toEqual({ v: 3200, f: "=B3+B4", s: { nf: NF } });
  });

  it("keeps bold and fills where the workbook exposes them, readable on dark fills", () => {
    const ws: XLSX.WorkSheet = {
      "!ref": "A1:B2",
      A1: { t: "s", v: "Title", s: { patternType: "solid", fgColor: { rgb: "1F3864" } } } as XLSX.CellObject,
      B1: { t: "z", s: { patternType: "solid", fgColor: { rgb: "EAF3F3" } } } as XLSX.CellObject,
      A2: { t: "s", v: "Bold", s: { font: { bold: true } } } as XLSX.CellObject,
      B2: { t: "z", s: { patternType: "none" } } as XLSX.CellObject,
    };
    const sheet = workbookToCbeSheet({ SheetNames: ["S"], Sheets: { S: ws } } as XLSX.WorkBook);
    const cells = sheet.sheets[0]!.cells;
    expect(cells.A1).toEqual({ v: "Title", s: { bg: "#1f3864", fc: "#ffffff" } });
    expect(cells.B1).toEqual({ s: { bg: "#eaf3f3" } });
    expect(cells.A2).toEqual({ v: "Bold", s: { b: 1 } });
    expect(cells.B2).toBeUndefined();
  });

  it("survives the Fortune round trip after import", () => {
    const sheet = xlsxToCbeSheet(readFileSync(FIXTURE));
    expect(cbeSheetSignature(fortuneToCbe(cbeToFortune(sheet)))).toBe(cbeSheetSignature(sheet));
  });
});

describe("extractMarkingScheme", () => {
  it("builds lines from a SheetJS-built workbook (Mark header, totals skipped)", () => {
    const scheme = extractMarkingScheme(xlsxToCbeSheet(buildWorkbookBytes()));
    expect(scheme).toEqual([
      { id: "m1", label: "Revenue", marks: 1, expected: "1000", cellRef: "P&L!B4", guidance: "per TB" },
      { id: "m2", label: "Cost of sales", marks: 1.5, expected: "(400)", cellRef: "P&L!B5" },
      { id: "m3", label: "Gross profit", marks: 2, expected: "600", cellRef: "P&L!B6", guidance: "W1" },
    ]);
  });

  it("reads the committed fixture: 4 lines, 5 marks, accounting-formatted expected values", () => {
    const scheme = extractMarkingScheme(xlsxToCbeSheet(readFileSync(FIXTURE)));
    expect(scheme.map((l) => [l.label, l.marks, l.expected, l.cellRef, l.guidance])).toEqual([
      ["Goodwill", 2, "3,200", "Consolidated SFP!B6", "W1: 3,800 − 600 impairment"],
      ["Property, plant and equipment", 1.5, "76,700", "Consolidated SFP!B7", undefined],
      ["Inventory", 1, "14,200", "Consolidated SFP!B8", "less PUP"],
      ["Loss on disposal", 0.5, "(900)", "Consolidated SFP!B10", undefined],
    ]);
    expect(scheme.reduce((s, l) => s + l.marks, 0)).toBe(5);
  });

  it("returns [] when there is no Marks column", () => {
    expect(extractMarkingScheme({ sheets: [{ name: "S", cells: { A1: { v: "Goodwill" }, B1: { v: 3 } } }] })).toEqual([]);
    expect(extractMarkingScheme(null)).toEqual([]);
  });

  it.skipIf(!REAL || !existsSync(REAL))("real solution workbook (CBE_REAL_XLSX): 15+ lines summing to 16", () => {
    const sheet = xlsxToCbeSheet(readFileSync(REAL));
    const sfp = sheet.sheets.find((t) => t.name === "Consolidated SFP");
    expect(sfp?.cells.B7).toMatchObject({ v: 3200, f: "=Workings!B41" });
    const scheme = extractMarkingScheme(sheet);
    expect(scheme.length).toBeGreaterThanOrEqual(15);
    expect(scheme.reduce((s, l) => s + l.marks, 0)).toBe(16);
    expect(scheme[0]).toEqual({
      id: "m1",
      label: "Goodwill",
      marks: 2,
      expected: "3,200",
      cellRef: "Consolidated SFP!B7",
      guidance: "W4: 3,800 − 600 impairment",
    });
  });
});
