/**
 * .xlsx -> CbeSheet (SheetJS) and marking-scheme extraction.
 *
 * Imports SheetJS at module level: load this file lazily
 * (`await import("@/components/cbe/xlsx-import")`) so `xlsx` stays out of the
 * main bundle. `extractMarkingScheme` itself is pure and needs no SheetJS.
 * Identical in both apps.
 */
import * as XLSX from "xlsx";
import { parseA1, sheetCellRef, toA1 } from "./a1";
import { formatCbeCell } from "./format";
import {
  CBE_DEFAULT_COL_COUNT,
  CBE_DEFAULT_ROW_COUNT,
  type CbeCell,
  type CbeCellStyle,
  type CbeMarkingLine,
  type CbeSheet,
  type CbeSheetTab,
} from "./types";

/** Spare rows / cols added under and right of the imported content. */
const SPARE_ROWS = 5;
const SPARE_COLS = 2;

const WHITE = "#ffffff"; // design-lint-ignore — spreadsheet font colour (data), not UI styling

type SheetJsStyle = {
  patternType?: string;
  fgColor?: { rgb?: string };
  font?: { bold?: boolean | number; italic?: boolean | number; underline?: boolean | number; color?: { rgb?: string } };
  bold?: boolean;
  alignment?: { horizontal?: string };
  border?: { top?: { style?: string }; bottom?: { style?: string } };
};

const toHex = (rgb: string | undefined): string | undefined => {
  if (!rgb || !/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(rgb)) return undefined;
  return `#${rgb.slice(-6).toLowerCase()}`;
};

/** Relative luminance 0..1 of "#rrggbb". */
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
};

function styleFrom(cell: XLSX.CellObject): CbeCellStyle {
  const s: CbeCellStyle = {};
  const st = (cell.s ?? {}) as SheetJsStyle;
  if (typeof cell.z === "string" && cell.z && cell.z !== "General") s.nf = cell.z;
  if (st.font?.bold || st.bold) s.b = 1;
  if (st.font?.italic) s.i = 1;
  if (st.font?.underline) s.u = 1;
  const h = st.alignment?.horizontal;
  if (h === "left") s.al = "l";
  else if (h === "center" || h === "centerContinuous") s.al = "c";
  else if (h === "right") s.al = "r";
  if (st.patternType === "solid") {
    const bg = toHex(st.fgColor?.rgb);
    if (bg && bg !== WHITE) s.bg = bg;
  }
  const fc = toHex(st.font?.color?.rgb);
  if (fc) s.fc = fc;
  // The community SheetJS build exposes fills but not fonts: keep text on a
  // dark fill readable when the workbook's own font colour is unavailable.
  if (!s.fc && s.bg && luminance(s.bg) < 0.2) s.fc = WHITE;
  if (st.border?.top?.style) s.bt = 1;
  if (st.border?.bottom?.style) s.bb = 1;
  return s;
}

function cellFrom(cell: XLSX.CellObject): CbeCell | null {
  const out: CbeCell = {};
  switch (cell.t) {
    case "n":
      if (typeof cell.v === "number" && Number.isFinite(cell.v)) out.v = cell.v;
      break;
    case "b":
      out.v = Boolean(cell.v);
      break;
    case "s":
      if (cell.v !== undefined && cell.v !== null && String(cell.v) !== "") out.v = String(cell.v);
      break;
    case "e":
      out.v = cell.w ?? "#ERROR!";
      break;
    case "d":
      out.v = cell.w ?? (cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v ?? ""));
      break;
    default:
      break; // "z" stub: style only
  }
  if (typeof cell.f === "string" && cell.f.trim()) out.f = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
  const s = styleFrom(cell);
  if (Object.keys(s).length) {
    // An empty stub only matters if it shows something (a fill or a border).
    const visibleOnEmpty = s.bg || s.bt || s.bb;
    if (out.v !== undefined || out.f || visibleOnEmpty) out.s = s;
  }
  return out.v !== undefined || out.f || out.s ? out : null;
}

const colWidthPx = (col: XLSX.ColInfo | undefined): number | undefined => {
  if (!col) return undefined;
  if (typeof col.wpx === "number" && col.wpx > 0) return Math.round(col.wpx);
  if (typeof col.wch === "number" && col.wch > 0) return Math.round(col.wch * 7 + 5);
  if (typeof col.width === "number" && col.width > 0) return Math.round(col.width * 7);
  return undefined;
};

export function worksheetToCbeTab(name: string, ws: XLSX.WorkSheet): CbeSheetTab {
  const cells: Record<string, CbeCell> = {};
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const pos = parseA1(key);
    const raw = ws[key] as XLSX.CellObject | undefined;
    if (!pos || !raw) continue;
    const cell = cellFrom(raw);
    if (!cell) continue;
    cells[toA1(pos.r, pos.c)] = cell;
    maxR = Math.max(maxR, pos.r);
    maxC = Math.max(maxC, pos.c);
  }
  const tab: CbeSheetTab = { name, cells };

  const merges = (ws["!merges"] ?? []).map((m) => XLSX.utils.encode_range(m)).filter((r) => r.includes(":"));
  if (merges.length) tab.merges = merges;

  const widths: Record<string, number> = {};
  (ws["!cols"] ?? []).forEach((col, i) => {
    const px = colWidthPx(col);
    if (px) widths[XLSX.utils.encode_col(i)] = px;
  });
  if (Object.keys(widths).length) tab.colWidths = widths;

  if (ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    maxR = Math.max(maxR, range.e.r);
    maxC = Math.max(maxC, range.e.c);
  }
  tab.rowCount = Math.max(CBE_DEFAULT_ROW_COUNT, maxR + 1 + SPARE_ROWS);
  tab.colCount = Math.max(CBE_DEFAULT_COL_COUNT, maxC + 1 + SPARE_COLS);
  return tab;
}

export function workbookToCbeSheet(wb: XLSX.WorkBook): CbeSheet {
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    return ws ? worksheetToCbeTab(name, ws) : { name, cells: {} };
  });
  return { sheets: sheets.length ? sheets : [{ name: "Sheet1", cells: {} }] };
}

/** Reads an .xlsx/.xls/.csv buffer into a CbeSheet: all tabs, formulas (with "=") and cached values. */
export function xlsxToCbeSheet(data: ArrayBuffer | Uint8Array): CbeSheet {
  const wb = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), {
    type: "array",
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
    cellDates: false,
  });
  return workbookToCbeSheet(wb);
}

/** Browser helper: File (from an <input type="file">) -> CbeSheet. */
export async function readXlsxFile(file: Blob): Promise<CbeSheet> {
  return xlsxToCbeSheet(await file.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Marking scheme
// ---------------------------------------------------------------------------

const MARKS_HEADER = /^marks?$/i;
const TOTAL_LABEL = /\btotal\s+marks?\b/i;

const numericMark = (cell: CbeCell | undefined): number | null => {
  const v = cell?.v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};

const isTextCell = (cell: CbeCell | undefined): cell is CbeCell & { v: string } =>
  !!cell && typeof cell.v === "string" && cell.v.trim() !== "" && !cell.f && numericMark(cell) === null;

const isFigureCell = (cell: CbeCell | undefined): boolean =>
  !!cell && (typeof cell.v === "number" || (!!cell.f && cell.f.trim() !== ""));

/**
 * Finds a "Marks" header cell in each tab and turns every row below it that has
 * a numeric mark into a marking line:
 *  - label     = first text cell in the row
 *  - expected  = formatted value of the first number/formula cell left of the marks column
 *  - cellRef   = "Tab!B7" of that cell
 *  - guidance  = next text cell after the value, if any
 * Total rows (a SUM in the marks column, or a "Total marks" label) are skipped.
 * Returns [] when no tab has a Marks column.
 */
export function extractMarkingScheme(sheet: CbeSheet | null | undefined): CbeMarkingLine[] {
  const lines: CbeMarkingLine[] = [];
  for (const tab of sheet?.sheets ?? []) {
    const grid = new Map<number, Map<number, CbeCell>>();
    let maxRow = -1;
    for (const [ref, cell] of Object.entries(tab.cells ?? {})) {
      const p = parseA1(ref);
      if (!p || !cell) continue;
      let row = grid.get(p.r);
      if (!row) {
        row = new Map();
        grid.set(p.r, row);
      }
      row.set(p.c, cell);
      maxRow = Math.max(maxRow, p.r);
    }

    // Header: first matching cell in row-major order.
    let header: { r: number; c: number } | null = null;
    for (const r of [...grid.keys()].sort((a, b) => a - b)) {
      const row = grid.get(r);
      if (!row) continue;
      for (const c of [...row.keys()].sort((a, b) => a - b)) {
        const v = row.get(c)?.v;
        if (typeof v === "string" && MARKS_HEADER.test(v.trim())) {
          header = { r, c };
          break;
        }
      }
      if (header) break;
    }
    if (!header) continue;
    const markCol = header.c;

    for (let r = header.r + 1; r <= maxRow; r += 1) {
      const row = grid.get(r);
      if (!row) continue;
      const markCell = row.get(markCol);
      const marks = numericMark(markCell);
      if (marks === null || marks <= 0) continue;
      if (markCell?.f && /\bSUM\s*\(/i.test(markCell.f)) continue;

      const cols = [...row.keys()].filter((c) => c !== markCol).sort((a, b) => a - b);
      const labelCol = cols.find((c) => isTextCell(row.get(c)));
      const label = labelCol === undefined ? "" : String(row.get(labelCol)?.v ?? "").trim();
      if (TOTAL_LABEL.test(label)) continue;

      const valueCol = cols.find((c) => c < markCol && isFigureCell(row.get(c)));
      const line: CbeMarkingLine = {
        id: `m${lines.length + 1}`,
        label: label || sheetCellRef(tab.name, toA1(r, markCol)),
        marks,
      };
      if (valueCol !== undefined) {
        line.expected = formatCbeCell(row.get(valueCol));
        line.cellRef = sheetCellRef(tab.name, toA1(r, valueCol));
        const guidanceCol = cols.find((c) => c > valueCol && isTextCell(row.get(c)));
        if (guidanceCol !== undefined) {
          const g = String(row.get(guidanceCol)?.v ?? "").trim();
          if (g) line.guidance = g;
        }
      }
      lines.push(line);
    }
  }
  return lines;
}
