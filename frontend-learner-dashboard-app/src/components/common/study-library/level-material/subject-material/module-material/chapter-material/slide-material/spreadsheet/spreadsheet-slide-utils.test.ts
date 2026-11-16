import { describe, expect, it } from "vitest";
import {
  parseSpreadsheetSlideData,
  spreadsheetDownloadName,
  spreadsheetSlideText,
  spreadsheetToPlainText,
} from "./spreadsheet-slide-utils";

/** The exact shape the admin app stores (serializeSpreadsheetData). */
const STORED = JSON.stringify({
  version: 1,
  sheet: {
    sheets: [
      {
        name: "TB",
        cells: {
          A1: { v: "Trial balance" },
          A2: { v: "Account" },
          B2: { v: "Debit" },
          A3: { v: "Cash" },
          B3: { v: 1200 },
          B5: { v: 1200, f: "=SUM(B3:B4)", s: { nf: "#,##0" } },
        },
        merges: ["A1:C1"],
      },
      { name: "Notes", cells: { A1: { v: "Cash in hand" } } },
    ],
  },
  file_id: "file-123",
  file_name: "TB 2026.xlsx",
  file_size: 4096,
  allow_download: true,
});

describe("parseSpreadsheetSlideData", () => {
  it("reads what the admin app stores", () => {
    const data = parseSpreadsheetSlideData(STORED);
    expect(data).not.toBeNull();
    expect(data!.fileId).toBe("file-123");
    expect(data!.fileName).toBe("TB 2026.xlsx");
    expect(data!.allowDownload).toBe(true);
    expect(data!.sheet.sheets.map((t) => t.name)).toEqual(["TB", "Notes"]);
    expect(data!.sheet.sheets[0]!.cells.B5).toEqual({ v: 1200, f: "=SUM(B3:B4)", s: { nf: "#,##0" } });
  });

  it("honours allow_download false and defaults a missing one to true", () => {
    const off = JSON.parse(STORED);
    off.allow_download = false;
    expect(parseSpreadsheetSlideData(off)!.allowDownload).toBe(false);
    const missing = JSON.parse(STORED);
    delete missing.allow_download;
    expect(parseSpreadsheetSlideData(missing)!.allowDownload).toBe(true);
  });

  it("returns null for junk", () => {
    expect(parseSpreadsheetSlideData(null)).toBeNull();
    expect(parseSpreadsheetSlideData("")).toBeNull();
    expect(parseSpreadsheetSlideData("<p>doc</p>")).toBeNull();
    expect(parseSpreadsheetSlideData('{"sheet":{"sheets":[]}}')).toBeNull();
  });
});

describe("spreadsheetDownloadName", () => {
  it("keeps the stored workbook name", () => {
    expect(spreadsheetDownloadName({ fileName: "TB 2026.xlsx" }, "Slide")).toBe("TB 2026.xlsx");
  });
  it("falls back to the slide title with .xlsx and strips path characters", () => {
    expect(spreadsheetDownloadName({ fileName: "" }, "Q1/Q2: results")).toBe("Q1 Q2 results.xlsx");
    expect(spreadsheetDownloadName({ fileName: "" }, "")).toBe("spreadsheet.xlsx");
  });
});

describe("spreadsheetToPlainText", () => {
  it("lists each tab with tab-separated rows in order", () => {
    const text = spreadsheetSlideText(STORED);
    expect(text).toBe(
      ["# TB", "Trial balance", "Account\tDebit", "Cash\t1200", "\t1200", "", "# Notes", "Cash in hand"].join("\n")
    );
  });
  it("caps the length", () => {
    const data = parseSpreadsheetSlideData(STORED)!;
    expect(spreadsheetToPlainText(data.sheet, 10).length).toBeLessThanOrEqual(10);
  });
  it("is empty for unreadable data", () => {
    expect(spreadsheetSlideText("nope")).toBe("");
  });
});
