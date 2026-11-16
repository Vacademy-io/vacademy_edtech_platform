/**
 * Spreadsheet (Excel) slide — learner-side reader of the stored JSON.
 *
 * A DOCUMENT slide with `document_slide.type = "SPREADSHEET"` keeps
 * `{ version, sheet, file_id, file_name, file_size, allow_download }` in
 * `published_data`. Mirrors the admin writer:
 * frontend-admin-dashboard/.../slides/-components/spreadsheet/spreadsheet-slide-data.ts
 *
 * Pure (no React, no imports beyond types) so it can be tested in isolation.
 */
import type { CbeCell, CbeSheet, CbeSheetTab } from "@/components/cbe/types";

export const SPREADSHEET_DOC_TYPE = "SPREADSHEET";

export type SpreadsheetSlideData = {
  sheet: CbeSheet;
  fileId: string | null;
  fileName: string;
  allowDownload: boolean;
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Reads the stored JSON (string or object). Null for anything that is not a spreadsheet payload. */
export function parseSpreadsheetSlideData(raw: unknown): SpreadsheetSlideData | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(obj)) return null;
  const sheet = obj.sheet;
  if (!isRecord(sheet) || !Array.isArray(sheet.sheets)) return null;
  const tabs = (sheet.sheets as unknown[]).filter(
    (t): t is CbeSheetTab => isRecord(t) && typeof t.name === "string" && isRecord(t.cells)
  );
  if (!tabs.length) return null;
  return {
    sheet: { sheets: tabs },
    fileId: typeof obj.file_id === "string" && obj.file_id ? obj.file_id : null,
    fileName: typeof obj.file_name === "string" ? obj.file_name : "",
    allowDownload: obj.allow_download !== false,
  };
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

/** Tutor text for a stored spreadsheet slide ("" when it cannot be read). */
export function spreadsheetSlideText(raw: unknown): string {
  const data = parseSpreadsheetSlideData(raw);
  return data ? spreadsheetToPlainText(data.sheet) : "";
}
