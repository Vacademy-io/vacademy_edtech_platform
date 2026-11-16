import { describe, expect, it } from "vitest";
import {
  loadSpreadsheetGrid,
  parseSpreadsheetGrid,
  parseSpreadsheetSlideData,
  spreadsheetDownloadName,
  spreadsheetSlideSummary,
  spreadsheetSlideText,
  spreadsheetToPlainText,
} from "./spreadsheet-slide-utils";

const GRID = {
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
};

/** The exact grid file the admin app uploads (serializeSpreadsheetGrid). */
const GRID_FILE = JSON.stringify({ version: 1, ...GRID });

/** The exact slide data the admin app stores (serializeSpreadsheetData). */
const STORED = JSON.stringify({
  version: 2,
  grid_file_id: "grid-456",
  file_id: "file-123",
  file_name: "TB 2026.xlsx",
  file_size: 4096,
  allow_download: true,
  sheet_names: ["TB", "Notes"],
  cell_count: 7,
});

/** A legacy (version 1, never shipped) payload with the grid inline. */
const LEGACY = JSON.stringify({
  version: 1,
  sheet: GRID,
  file_id: "file-123",
  file_name: "TB 2026.xlsx",
  file_size: 4096,
  allow_download: true,
});

const response = (body: string, init: { status?: number; length?: number } = {}) =>
  ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers(init.length !== undefined ? { "content-length": String(init.length) } : {}),
    text: async () => body,
  }) as unknown as Response;

describe("parseSpreadsheetSlideData", () => {
  it("reads the metadata the admin app stores", () => {
    const data = parseSpreadsheetSlideData(STORED);
    expect(data).toEqual({
      gridFileId: "grid-456",
      sheet: null,
      fileId: "file-123",
      fileName: "TB 2026.xlsx",
      allowDownload: true,
      sheetNames: ["TB", "Notes"],
    });
  });

  it("still reads a legacy payload with the grid inline", () => {
    const data = parseSpreadsheetSlideData(LEGACY);
    expect(data).not.toBeNull();
    expect(data!.gridFileId).toBeNull();
    expect(data!.sheet!.sheets.map((t) => t.name)).toEqual(["TB", "Notes"]);
    expect(data!.sheet!.sheets[0]!.cells.B5).toEqual({ v: 1200, f: "=SUM(B3:B4)", s: { nf: "#,##0" } });
    expect(data!.sheetNames).toEqual(["TB", "Notes"]);
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
    expect(parseSpreadsheetSlideData('{"grid_file_id":""}')).toBeNull();
  });
});

describe("parseSpreadsheetGrid", () => {
  it("reads the grid file", () => {
    const sheet = parseSpreadsheetGrid(GRID_FILE);
    expect(sheet!.sheets.map((t) => t.name)).toEqual(["TB", "Notes"]);
    expect(sheet!.sheets[0]!.merges).toEqual(["A1:C1"]);
  });
  it("returns null for a file with no readable tab", () => {
    expect(parseSpreadsheetGrid('{"version":1,"sheets":[]}')).toBeNull();
    expect(parseSpreadsheetGrid("not json")).toBeNull();
  });
});

describe("loadSpreadsheetGrid", () => {
  it("resolves the file id to a URL and reads the grid", async () => {
    const seen: string[] = [];
    const sheet = await loadSpreadsheetGrid("grid-456", {
      getUrl: async (id) => `https://media.example/${id}`,
      fetchImpl: async (url) => {
        seen.push(url);
        return response(GRID_FILE);
      },
    });
    expect(seen).toEqual(["https://media.example/grid-456"]);
    expect(sheet.sheets).toHaveLength(2);
  });

  it("fails on a missing URL, an HTTP error, an unreadable file or an oversized file", async () => {
    const getUrl = async () => "https://media.example/g";
    await expect(
      loadSpreadsheetGrid("g", { getUrl: async () => "", fetchImpl: async () => response(GRID_FILE) })
    ).rejects.toThrow("no url");
    await expect(
      loadSpreadsheetGrid("g", { getUrl, fetchImpl: async () => response("", { status: 403 }) })
    ).rejects.toThrow("http 403");
    await expect(
      loadSpreadsheetGrid("g", { getUrl, fetchImpl: async () => response("{}") })
    ).rejects.toThrow("unreadable");
    await expect(
      loadSpreadsheetGrid("g", { getUrl, maxChars: 10, fetchImpl: async () => response(GRID_FILE) })
    ).rejects.toThrow("too large");
    await expect(
      loadSpreadsheetGrid("g", {
        getUrl,
        maxChars: 10,
        fetchImpl: async () => response("{}", { length: 1_000 }),
      })
    ).rejects.toThrow("too large");
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
    const text = spreadsheetToPlainText(parseSpreadsheetGrid(GRID_FILE)!);
    expect(text).toBe(
      ["# TB", "Trial balance", "Account\tDebit", "Cash\t1200", "\t1200", "", "# Notes", "Cash in hand"].join("\n")
    );
    // A legacy inline grid gives the same text without any download.
    expect(spreadsheetSlideText(LEGACY)).toBe(text);
  });
  it("caps the length", () => {
    expect(spreadsheetToPlainText(parseSpreadsheetGrid(GRID_FILE)!, 10).length).toBeLessThanOrEqual(10);
  });
  it("falls back to the file and tab names when the grid is in its own file", () => {
    expect(spreadsheetSlideText(STORED)).toBe('Spreadsheet "TB 2026.xlsx" with tabs: TB, Notes');
    expect(spreadsheetSlideSummary({ fileName: "", sheetNames: [] })).toBe("Spreadsheet");
  });
  it("is empty for unreadable data", () => {
    expect(spreadsheetSlideText("nope")).toBe("");
  });
});
