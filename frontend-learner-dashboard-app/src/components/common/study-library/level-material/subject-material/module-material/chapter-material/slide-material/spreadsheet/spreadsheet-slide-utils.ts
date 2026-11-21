/**
 * Spreadsheet (Excel) slide — learner-side reader of the stored JSON.
 *
 * A DOCUMENT slide with `document_slide.type = "SPREADSHEET"` keeps small
 * metadata in `published_data`:
 * `{ version: 2, grid_file_id, file_id, file_name, file_size, allow_download, sheet_names, cell_count }`.
 * The grid itself is a separate JSON media file (`grid_file_id`, contents
 * `{ version, sheets }`) fetched when the slide opens. Mirrors the admin writer:
 * frontend-admin-dashboard/.../slides/-components/spreadsheet/spreadsheet-slide-data.ts
 *
 * A legacy payload (version 1, never shipped) carried the grid inline as
 * `sheet`; it is still read so old local test data renders.
 *
 * Pure (no React, no app imports beyond types) so it can be tested in isolation.
 */
import type { CbeCell, CbeSheet, CbeSheetTab } from "@/components/cbe/types";

export const SPREADSHEET_DOC_TYPE = "SPREADSHEET";

/**
 * Largest grid file the learner app will read. The admin import caps the file
 * at 1,200,000 characters; anything far bigger is refused rather than parsed.
 */
export const SPREADSHEET_GRID_MAX_CHARS = 2_400_000;

export type SpreadsheetSlideData = {
  /** Media file id of the grid JSON; null for a legacy inline grid. */
  gridFileId: string | null;
  /** Legacy inline grid (version 1); null when the grid is in its own file. */
  sheet: CbeSheet | null;
  fileId: string | null;
  fileName: string;
  allowDownload: boolean;
  sheetNames: string[];
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw;
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Reads a grid: the grid file (`{ version, sheets }`), a bare sheet, or a legacy
 * slide payload (`{ sheet: { sheets } }`). Null when there is no readable tab.
 */
export function parseSpreadsheetGrid(raw: unknown): CbeSheet | null {
  let obj = parseJson(raw);
  if (!isRecord(obj)) return null;
  if (!Array.isArray(obj.sheets) && isRecord(obj.sheet)) obj = obj.sheet;
  if (!isRecord(obj) || !Array.isArray(obj.sheets)) return null;
  const tabs = (obj.sheets as unknown[]).filter(
    (t): t is CbeSheetTab => isRecord(t) && typeof t.name === "string" && isRecord(t.cells)
  );
  return tabs.length ? { sheets: tabs } : null;
}

/** Reads the stored slide JSON (string or object). Null for anything that is not a spreadsheet payload. */
export function parseSpreadsheetSlideData(raw: unknown): SpreadsheetSlideData | null {
  const obj = parseJson(raw);
  if (!isRecord(obj)) return null;
  const gridFileId =
    typeof obj.grid_file_id === "string" && obj.grid_file_id ? obj.grid_file_id : null;
  const sheet = gridFileId ? null : parseSpreadsheetGrid(obj.sheet ?? null);
  if (!gridFileId && !sheet) return null;
  const storedNames = Array.isArray(obj.sheet_names)
    ? (obj.sheet_names as unknown[]).filter((n): n is string => typeof n === "string")
    : [];
  return {
    gridFileId,
    sheet,
    fileId: typeof obj.file_id === "string" && obj.file_id ? obj.file_id : null,
    fileName: typeof obj.file_name === "string" ? obj.file_name : "",
    allowDownload: obj.allow_download !== false,
    sheetNames: storedNames.length ? storedNames : (sheet?.sheets.map((t) => t.name) ?? []),
  };
}

export class SpreadsheetGridLoadError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SpreadsheetGridLoadError";
  }
}

/**
 * Downloads and reads a grid file. `getUrl` resolves the media file id to a
 * signed URL; `fetchImpl` defaults to the browser fetch. Refuses files over
 * `maxChars` (by Content-Length when sent, and by the text read).
 */
export async function loadSpreadsheetGrid(
  gridFileId: string,
  deps: {
    getUrl: (fileId: string) => Promise<string>;
    fetchImpl?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
    signal?: AbortSignal;
    maxChars?: number;
  }
): Promise<CbeSheet> {
  const maxChars = deps.maxChars ?? SPREADSHEET_GRID_MAX_CHARS;
  const url = await deps.getUrl(gridFileId);
  if (!url) throw new SpreadsheetGridLoadError("no url");
  const doFetch = deps.fetchImpl ?? ((u, init) => fetch(u, init));
  const res = await doFetch(url, { signal: deps.signal });
  if (!res.ok) throw new SpreadsheetGridLoadError(`http ${res.status}`);
  const declared = Number(res.headers?.get?.("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxChars * 4) {
    throw new SpreadsheetGridLoadError("too large");
  }
  const text = await res.text();
  if (text.length > maxChars) throw new SpreadsheetGridLoadError("too large");
  const sheet = parseSpreadsheetGrid(text);
  if (!sheet) throw new SpreadsheetGridLoadError("unreadable");
  return sheet;
}

/** Short tutor text when the grid itself is not at hand: file name and tab names. */
export function spreadsheetSlideSummary(
  data: Pick<SpreadsheetSlideData, "fileName" | "sheetNames">
): string {
  const name = data.fileName ? `Spreadsheet "${data.fileName}"` : "Spreadsheet";
  return data.sheetNames.length ? `${name} with tabs: ${data.sheetNames.join(", ")}` : name;
}

/** A safe download name: the stored file name, else the slide title + .xlsx. */
export function spreadsheetDownloadName(
  data: Pick<SpreadsheetSlideData, "fileName">,
  title: string | null | undefined
): string {
  const clean = (s: string) =>
    s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const stored = clean(data.fileName || "");
  if (stored && /\.(xlsx|xls|csv)$/i.test(stored)) return stored;
  const base = clean(stored || title || "") || "spreadsheet";
  return `${base}.xlsx`;
}

/** "A1" -> [row, col] (0-based); null when not an A1 ref. */
function refToRowCol(ref: string): [number, number] | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

const cellText = (cell: CbeCell | undefined): string => {
  const v = cell?.v;
  if (v === undefined || v === null) return "";
  return String(v).replace(/[\t\r\n]+/g, " ").trim();
};

/**
 * Plain text of the grid for the course AI tutor: each tab as a heading and
 * tab-separated rows of the raw values, capped at `maxChars`.
 */
export function spreadsheetToPlainText(sheet: CbeSheet, maxChars = 20_000): string {
  const parts: string[] = [];
  let used = 0;
  for (const tab of sheet.sheets ?? []) {
    const rows = new Map<number, Map<number, string>>();
    for (const [ref, cell] of Object.entries(tab.cells ?? {})) {
      const pos = refToRowCol(ref);
      const text = cellText(cell);
      if (!pos || !text) continue;
      let row = rows.get(pos[0]);
      if (!row) {
        row = new Map();
        rows.set(pos[0], row);
      }
      row.set(pos[1], text);
    }
    const lines = [`# ${tab.name}`];
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      const row = rows.get(r)!;
      const maxCol = Math.max(...row.keys());
      const cols: string[] = [];
      for (let c = 0; c <= maxCol; c += 1) cols.push(row.get(c) ?? "");
      lines.push(cols.join("\t"));
    }
    const block = lines.join("\n");
    if (used + block.length > maxChars) {
      parts.push(block.slice(0, Math.max(0, maxChars - used)));
      break;
    }
    parts.push(block);
    used += block.length + 2;
  }
  return parts.join("\n\n");
}

/**
 * Tutor text for a stored spreadsheet slide without any network: the cell
 * values for a legacy inline grid, else the short summary ("" when it cannot
 * be read).
 */
export function spreadsheetSlideText(raw: unknown): string {
  const data = parseSpreadsheetSlideData(raw);
  if (!data) return "";
  return data.sheet ? spreadsheetToPlainText(data.sheet) : spreadsheetSlideSummary(data);
}
