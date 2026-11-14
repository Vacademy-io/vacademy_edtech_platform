/**
 * CbeSheet ⇄ Fortune-sheet `Sheet[]`. The only place that knows Fortune-sheet's
 * data model; nothing outside src/components/cbe ever sees it.
 *
 * Fortune types are declared structurally here (the app does not depend on
 * @fortune-sheet/core directly), covering just what we read and write.
 * Identical in both apps.
 */
import { colToLetters, lettersToCol, parseA1, parseRange, toA1 } from "./a1";
import { formatCbeValue } from "./format";
import {
  CBE_DEFAULT_COL_COUNT,
  CBE_DEFAULT_ROW_COUNT,
  type CbeCell,
  type CbeCellStyle,
  type CbeCellValue,
  type CbeSheet,
  type CbeSheetTab,
} from "./types";

export type FortuneCell = {
  v?: string | number | boolean | null;
  m?: string | number;
  f?: string;
  ct?: { fa?: string; t?: string; s?: Array<{ v?: string | number }> };
  bl?: number;
  it?: number;
  un?: number;
  ht?: number | string;
  bg?: string;
  fc?: string;
  mc?: { r: number; c: number; rs?: number; cs?: number };
  [key: string]: unknown;
};

export type FortuneCellWithPos = { r: number; c: number; v: FortuneCell | null };

export type FortuneRange = { row: [number, number] | number[]; column: [number, number] | number[] };

export type FortuneBorderInfo =
  | {
      rangeType: "range";
      borderType: string;
      color?: string;
      style?: string | number;
      range: FortuneRange[];
    }
  | {
      rangeType: "cell";
      value: {
        row_index: number;
        col_index: number;
        l?: unknown;
        r?: unknown;
        t?: unknown;
        b?: unknown;
      };
    };

export type FortuneSheetConfig = {
  merge?: Record<string, { r: number; c: number; rs: number; cs: number }>;
  columnlen?: Record<string, number>;
  borderInfo?: FortuneBorderInfo[];
  [key: string]: unknown;
};

export type FortuneSheet = {
  name: string;
  id?: string;
  order?: number;
  status?: number;
  row?: number;
  column?: number;
  celldata?: FortuneCellWithPos[];
  data?: Array<Array<FortuneCell | null>>;
  config?: FortuneSheetConfig;
  [key: string]: unknown;
};

// Fortune `ht`: 0 = centre, 1 = left, 2 = right.
const AL_TO_HT: Record<NonNullable<CbeCellStyle["al"]>, number> = { c: 0, l: 1, r: 2 };
const htToAl = (ht: unknown): CbeCellStyle["al"] | undefined => {
  const n = typeof ht === "string" ? Number(ht) : ht;
  if (n === 0) return "c";
  if (n === 1) return "l";
  if (n === 2) return "r";
  return undefined;
};

/** Fortune-sheet's default row height and column width (core defaultrowlen / defaultcollen). */
const FORTUNE_ROW_PX = 19;
const FORTUNE_COL_PX = 73;

/** Border colour Fortune-sheet draws with; a value inside sheet data, not UI styling. */
const BORDER_COLOR = "#000000"; // design-lint-ignore — spreadsheet data, not a UI colour

const isNumericString = (s: string) => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s.trim());

/** Numbers and formula results: right-aligned unless the cell says otherwise. */
const isFigure = (v: unknown, f: unknown): boolean => typeof v === "number" || (typeof f === "string" && f.trim() !== "" && (v === undefined || v === null || typeof v === "number"));

// ---------------------------------------------------------------------------
// CbeSheet -> Fortune
// ---------------------------------------------------------------------------

function cbeCellToFortune(cell: CbeCell): FortuneCell {
  const out: FortuneCell = {};
  const s = cell.s ?? {};
  const v = cell.v;
  if (v !== undefined && v !== null) {
    out.v = v;
    out.m = formatCbeValue(v, s.nf);
  }
  if (cell.f) out.f = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
  const fa = s.nf ?? "General";
  out.ct = { fa, t: typeof v === "number" || (cell.f && v == null) ? "n" : "g" };
  if (s.b) out.bl = 1;
  if (s.i) out.it = 1;
  if (s.u) out.un = 1;
  if (s.al) out.ht = AL_TO_HT[s.al];
  // Fortune left-aligns everything by default; figures read right-aligned (as in
  // Excel and SheetView). fortuneCellToCbe drops this implicit "r" again.
  else if (isFigure(v, cell.f)) out.ht = AL_TO_HT.r;
  if (s.bg) out.bg = s.bg;
  if (s.fc) out.fc = s.fc;
  return out;
}

function usedExtent(tab: CbeSheetTab): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const ref of Object.keys(tab.cells ?? {})) {
    const p = parseA1(ref);
    if (!p) continue;
    rows = Math.max(rows, p.r + 1);
    cols = Math.max(cols, p.c + 1);
  }
  for (const m of tab.merges ?? []) {
    const r = parseRange(m);
    if (!r) continue;
    rows = Math.max(rows, r.e.r + 1);
    cols = Math.max(cols, r.e.c + 1);
  }
  return { rows, cols };
}

export type CbeToFortuneOptions = {
  /**
   * Also emit Fortune's dense `data` matrix. Fortune only expands `celldata`
   * for the sheet it opens, so cross-sheet formulas (=Workings!B41) cannot see
   * other tabs until they are visited; dense data makes every tab live at once.
   */
  dense?: boolean;
};

export function cbeTabToFortune(tab: CbeSheetTab, index: number, options: CbeToFortuneOptions = {}): FortuneSheet {
  const used = usedExtent(tab);
  const rowCount = Math.max(tab.rowCount ?? CBE_DEFAULT_ROW_COUNT, used.rows);
  const colCount = Math.max(tab.colCount ?? CBE_DEFAULT_COL_COUNT, used.cols);
  const byPos = new Map<string, FortuneCell>();
  const borderInfo: FortuneBorderInfo[] = [];

  for (const [ref, cell] of Object.entries(tab.cells ?? {})) {
    const p = parseA1(ref);
    if (!p || !cell) continue;
    byPos.set(`${p.r}_${p.c}`, cbeCellToFortune(cell));
    const single: FortuneRange = { row: [p.r, p.r], column: [p.c, p.c] };
    if (cell.s?.bt) {
      borderInfo.push({ rangeType: "range", borderType: "border-top", color: BORDER_COLOR, style: "1", range: [single] });
    }
    if (cell.s?.bb) {
      borderInfo.push({ rangeType: "range", borderType: "border-bottom", color: BORDER_COLOR, style: "1", range: [single] });
    }
  }

  const merge: NonNullable<FortuneSheetConfig["merge"]> = {};
  for (const m of tab.merges ?? []) {
    const r = parseRange(m);
    if (!r) continue;
    const rs = r.e.r - r.s.r + 1;
    const cs = r.e.c - r.s.c + 1;
    if (rs === 1 && cs === 1) continue;
    merge[`${r.s.r}_${r.s.c}`] = { r: r.s.r, c: r.s.c, rs, cs };
    for (let rr = r.s.r; rr <= r.e.r; rr += 1) {
      for (let cc = r.s.c; cc <= r.e.c; cc += 1) {
        const key = `${rr}_${cc}`;
        const existing = byPos.get(key) ?? {};
        existing.mc = rr === r.s.r && cc === r.s.c ? { r: r.s.r, c: r.s.c, rs, cs } : { r: r.s.r, c: r.s.c };
        byPos.set(key, existing);
      }
    }
  }

  const columnlen: Record<string, number> = {};
  for (const [letters, px] of Object.entries(tab.colWidths ?? {})) {
    const c = lettersToCol(letters);
    if (c >= 0 && Number.isFinite(px) && px > 0) columnlen[String(c)] = Math.round(px);
  }

  const celldata: FortuneCellWithPos[] = [];
  for (const [key, v] of byPos) {
    const [r, c] = key.split("_").map(Number);
    celldata.push({ r: r ?? 0, c: c ?? 0, v });
  }
  celldata.sort((a, b) => a.r - b.r || a.c - b.c);

  const config: FortuneSheetConfig = {};
  if (Object.keys(merge).length) config.merge = merge;
  if (Object.keys(columnlen).length) {
    config.columnlen = columnlen;
    config.customWidth = Object.fromEntries(Object.keys(columnlen).map((k) => [k, 1]));
  }
  if (borderInfo.length) config.borderInfo = borderInfo;

  // Start on A1 (its whole merge when A1 is merged). Without a stored selection
  // Fortune selects { row: [0], column: [0] }, a range with no end, and its name
  // box reads "A1:NaN" until the first click. The pixel box is what Fortune's
  // normalizeSelection would compute (each row/column is its size + 1px grid
  // line); without it the selection outline is drawn 0×0 until the first click.
  const a1Merge = merge["0_0"];
  const lastRow = a1Merge ? a1Merge.rs - 1 : 0;
  const lastCol = a1Merge ? a1Merge.cs - 1 : 0;
  let height = -1;
  for (let r = 0; r <= lastRow; r += 1) height += FORTUNE_ROW_PX + 1;
  let width = -1;
  for (let c = 0; c <= lastCol; c += 1) width += (columnlen[String(c)] ?? FORTUNE_COL_PX) + 1;
  const initialSelection = [
    {
      row: [0, lastRow],
      column: [0, lastCol],
      row_focus: 0,
      column_focus: 0,
      left: 0,
      top: 0,
      width,
      height,
      left_move: 0,
      top_move: 0,
      width_move: width,
      height_move: height,
    },
  ];

  const out: FortuneSheet = {
    name: tab.name,
    id: `cbe_sheet_${index}`,
    order: index,
    status: index === 0 ? 1 : 0,
    row: rowCount,
    column: colCount,
    celldata,
    config,
    luckysheet_select_save: initialSelection,
  };
  if (options.dense) {
    const data: Array<Array<FortuneCell | null>> = Array.from({ length: rowCount }, () =>
      Array<FortuneCell | null>(colCount).fill(null),
    );
    for (const { r, c, v } of celldata) {
      const row = data[r];
      if (row && c < colCount) row[c] = v;
    }
    out.data = data;
  }
  return out;
}

/** CbeSheet -> Fortune `data` prop. Always at least one sheet. */
export function cbeToFortune(sheet: CbeSheet | null | undefined, options: CbeToFortuneOptions = {}): FortuneSheet[] {
  const tabs = sheet?.sheets?.length ? sheet.sheets : [{ name: "Sheet1", cells: {} }];
  return tabs.map((t, i) => cbeTabToFortune(t, i, options));
}

// ---------------------------------------------------------------------------
// Fortune -> CbeSheet
// ---------------------------------------------------------------------------

function fortuneValue(cell: FortuneCell): CbeCellValue | undefined {
  let v: unknown = cell.v;
  if ((v === undefined || v === null || v === "") && cell.ct?.t === "inlineStr" && Array.isArray(cell.ct.s)) {
    v = cell.ct.s.map((seg) => (seg?.v === undefined ? "" : String(seg.v))).join("");
  }
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (cell.ct?.t === "n" && isNumericString(v)) return Number(v);
    return v;
  }
  return String(v);
}

function fortuneCellToCbe(cell: FortuneCell): CbeCell | null {
  const out: CbeCell = {};
  const v = fortuneValue(cell);
  if (v !== undefined) out.v = v;
  if (typeof cell.f === "string" && cell.f.trim()) {
    out.f = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
  }
  const s: CbeCellStyle = {};
  if (Number(cell.bl) === 1) s.b = 1;
  if (Number(cell.it) === 1) s.i = 1;
  if (Number(cell.un) === 1) s.u = 1;
  const al = htToAl(cell.ht);
  if (al && !(al === "r" && isFigure(out.v, out.f))) s.al = al;
  const fa = cell.ct?.fa;
  if (typeof fa === "string" && fa && fa !== "General" && fa !== "@") s.nf = fa;
  if (typeof cell.bg === "string" && cell.bg) s.bg = cell.bg;
  if (typeof cell.fc === "string" && cell.fc && !/^#(?:0{3}){1,2}$|^rgb\(0, ?0, ?0\)$/i.test(cell.fc)) s.fc = cell.fc;
  if (Object.keys(s).length) out.s = s;
  return out.v !== undefined || out.f || out.s ? out : null;
}

const asPair = (x: number[] | undefined): [number, number] | null =>
  x && x.length >= 2 && Number.isFinite(x[0]) && Number.isFinite(x[1])
    ? [Math.min(x[0] as number, x[1] as number), Math.max(x[0] as number, x[1] as number)]
    : x && x.length === 1 && Number.isFinite(x[0])
      ? [x[0] as number, x[0] as number]
      : null;

/**
 * Resolves Fortune's ordered border list to per-cell top/bottom flags (the
 * only borders the contract carries). Later entries win; "border-none" clears.
 */
export function bordersToCellFlags(borderInfo: FortuneBorderInfo[] | undefined): Map<string, { bt?: 1; bb?: 1 }> {
  const flags = new Map<string, { bt?: 1; bb?: 1 }>();
  const get = (r: number, c: number) => {
    const k = `${r}_${c}`;
    let f = flags.get(k);
    if (!f) {
      f = {};
      flags.set(k, f);
    }
    return f;
  };
  for (const info of borderInfo ?? []) {
    if (!info) continue;
    if (info.rangeType === "cell") {
      const { row_index: r, col_index: c, t, b } = info.value ?? ({} as never);
      if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
      const f = get(r, c);
      if (t) f.bt = 1;
      else if (t === null) delete f.bt;
      if (b) f.bb = 1;
      else if (b === null) delete f.bb;
      continue;
    }
    for (const range of info.range ?? []) {
      const rows = asPair(range.row);
      const cols = asPair(range.column);
      if (!rows || !cols) continue;
      const [r1, r2] = rows;
      const [c1, c2] = cols;
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          switch (info.borderType) {
            case "border-top":
              if (r === r1) get(r, c).bt = 1;
              break;
            case "border-bottom":
              if (r === r2) get(r, c).bb = 1;
              break;
            case "border-all":
              get(r, c).bt = 1;
              get(r, c).bb = 1;
              break;
            case "border-outside":
              if (r === r1) get(r, c).bt = 1;
              if (r === r2) get(r, c).bb = 1;
              break;
            case "border-inside":
            case "border-horizontal":
              if (r < r2) get(r, c).bb = 1;
              break;
            case "border-none": {
              const f = get(r, c);
              delete f.bt;
              delete f.bb;
              break;
            }
            default:
              break; // left/right/vertical/slash: not carried
          }
        }
      }
    }
  }
  return flags;
}

function* iterateFortuneCells(sheet: FortuneSheet): Generator<{ r: number; c: number; cell: FortuneCell }> {
  const data = sheet.data;
  if (Array.isArray(data) && data.length > 0) {
    for (let r = 0; r < data.length; r += 1) {
      const row = data[r];
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c += 1) {
        const cell = row[c];
        if (cell && typeof cell === "object") yield { r, c, cell };
      }
    }
    return;
  }
  for (const item of sheet.celldata ?? []) {
    if (item?.v && typeof item.v === "object") yield { r: item.r, c: item.c, cell: item.v };
  }
}

export function fortuneTabToCbe(sheet: FortuneSheet): CbeSheetTab {
  const cells: Record<string, CbeCell> = {};
  let usedRows = 0;
  let usedCols = 0;
  for (const { r, c, cell } of iterateFortuneCells(sheet)) {
    const cbe = fortuneCellToCbe(cell);
    if (!cbe) continue;
    cells[toA1(r, c)] = cbe;
    usedRows = Math.max(usedRows, r + 1);
    usedCols = Math.max(usedCols, c + 1);
  }

  const borders = bordersToCellFlags(sheet.config?.borderInfo);
  for (const [key, f] of borders) {
    if (!f.bt && !f.bb) continue;
    const [r, c] = key.split("_").map(Number);
    const ref = toA1(r ?? 0, c ?? 0);
    const cell = cells[ref] ?? {};
    cell.s = { ...(cell.s ?? {}), ...(f.bt ? { bt: 1 as const } : {}), ...(f.bb ? { bb: 1 as const } : {}) };
    cells[ref] = cell;
  }

  const tab: CbeSheetTab = { name: sheet.name || "Sheet1", cells };

  const merges = Object.values(sheet.config?.merge ?? {})
    .filter((m) => m && (m.rs > 1 || m.cs > 1))
    .sort((a, b) => a.r - b.r || a.c - b.c)
    .map((m) => `${toA1(m.r, m.c)}:${toA1(m.r + m.rs - 1, m.c + m.cs - 1)}`);
  if (merges.length) tab.merges = merges;

  const widths: Record<string, number> = {};
  for (const [k, px] of Object.entries(sheet.config?.columnlen ?? {})) {
    const c = Number(k);
    if (Number.isInteger(c) && c >= 0 && Number.isFinite(px) && px > 0) widths[colToLetters(c)] = Math.round(px);
  }
  if (Object.keys(widths).length) tab.colWidths = widths;

  const dataRows = Array.isArray(sheet.data) ? sheet.data.length : 0;
  const dataCols = Array.isArray(sheet.data?.[0]) ? (sheet.data?.[0]?.length ?? 0) : 0;
  tab.rowCount = Math.max(Number(sheet.row) || 0, dataRows, usedRows) || CBE_DEFAULT_ROW_COUNT;
  tab.colCount = Math.max(Number(sheet.column) || 0, dataCols, usedCols) || CBE_DEFAULT_COL_COUNT;
  return tab;
}

/** Fortune `Sheet[]` (onChange / getAllSheets) -> CbeSheet, tabs in sheet order. */
export function fortuneToCbe(sheets: FortuneSheet[] | null | undefined): CbeSheet {
  const list = [...(sheets ?? [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  if (!list.length) return { sheets: [{ name: "Sheet1", cells: {}, rowCount: CBE_DEFAULT_ROW_COUNT, colCount: CBE_DEFAULT_COL_COUNT }] };
  return { sheets: list.map(fortuneTabToCbe) };
}

/**
 * Canonical form for comparisons: default row/col counts filled in, cells and
 * keys in a stable order. Two sheets that render the same compare equal.
 */
export function normalizeCbeSheet(sheet: CbeSheet): CbeSheet {
  return {
    sheets: sheet.sheets.map((t) => {
      const used = usedExtent(t);
      const cells: Record<string, CbeCell> = {};
      for (const ref of Object.keys(t.cells ?? {}).sort((a, b) => {
        const pa = parseA1(a);
        const pb = parseA1(b);
        return (pa?.r ?? 0) - (pb?.r ?? 0) || (pa?.c ?? 0) - (pb?.c ?? 0);
      })) {
        const cell = t.cells[ref];
        if (!cell) continue;
        const out: CbeCell = {};
        if (cell.v !== undefined && cell.v !== null && cell.v !== "") out.v = cell.v;
        if (cell.f) out.f = cell.f;
        if (cell.s && Object.keys(cell.s).length) {
          const s: Record<string, unknown> = {};
          for (const k of Object.keys(cell.s).sort()) {
            const val = (cell.s as Record<string, unknown>)[k];
            if (val !== undefined && !(k === "nf" && val === "General")) s[k] = val;
          }
          if (Object.keys(s).length) out.s = s as CbeCellStyle;
        }
        if (out.v !== undefined || out.f || out.s) cells[ref] = out;
      }
      const tab: CbeSheetTab = { name: t.name, cells };
      if (t.colWidths && Object.keys(t.colWidths).length) tab.colWidths = { ...t.colWidths };
      if (t.merges?.length) tab.merges = [...t.merges].sort();
      tab.rowCount = Math.max(t.rowCount ?? CBE_DEFAULT_ROW_COUNT, used.rows);
      tab.colCount = Math.max(t.colCount ?? CBE_DEFAULT_COL_COUNT, used.cols);
      return tab;
    }),
  };
}

/** Stable JSON of a sheet's normalised form, for cheap "did anything change" checks. */
export const cbeSheetSignature = (sheet: CbeSheet): string => JSON.stringify(normalizeCbeSheet(sheet));

/** True when some formula cell has no computed value (needs a recalculation). */
export const hasUncomputedFormulas = (sheet: CbeSheet | null | undefined): boolean =>
  (sheet?.sheets ?? []).some((t) =>
    Object.values(t.cells ?? {}).some((c) => !!c?.f && (c.v === undefined || c.v === null || c.v === "")),
  );
