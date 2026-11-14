/**
 * A1 reference helpers. Rows and columns are 0-based everywhere in code
 * ("A1" = { r: 0, c: 0 }). Identical in both apps.
 */

export type CellPos = { r: number; c: number };
export type CellRange = { s: CellPos; e: CellPos };

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colToLetters(col: number): string {
  if (!Number.isInteger(col) || col < 0) throw new RangeError(`Invalid column index ${col}`);
  let n = col + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "A" -> 0, "AA" -> 26. Returns -1 for anything that is not letters. */
export function lettersToCol(letters: string): number {
  const s = letters.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return -1;
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

/** (6, 1) -> "B7". */
export const toA1 = (r: number, c: number): string => `${colToLetters(c)}${r + 1}`;

/** "B7" / "$B$7" -> { r: 6, c: 1 }; null when not a single-cell ref. */
export function parseA1(ref: string): CellPos | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
  if (!m) return null;
  const c = lettersToCol(m[1] ?? "");
  const r = Number(m[2]) - 1;
  if (c < 0 || r < 0) return null;
  return { r, c };
}

/** "A1:C2" (or a single "B7") -> normalised range (s = top-left). */
export function parseRange(range: string): CellRange | null {
  const [a, b] = range.split(":");
  const s = parseA1(a ?? "");
  const e = b === undefined ? s : parseA1(b);
  if (!s || !e) return null;
  return {
    s: { r: Math.min(s.r, e.r), c: Math.min(s.c, e.c) },
    e: { r: Math.max(s.r, e.r), c: Math.max(s.c, e.c) },
  };
}

export const rangeToA1 = (range: CellRange): string =>
  `${toA1(range.s.r, range.s.c)}:${toA1(range.e.r, range.e.c)}`;

/**
 * "Consolidated SFP!B7" / "'My tab'!B7" -> { sheet, ref }. A bare "B7" gives
 * sheet null.
 */
export function splitSheetRef(full: string): { sheet: string | null; ref: string } {
  const i = full.lastIndexOf("!");
  if (i < 0) return { sheet: null, ref: full.trim() };
  let sheet = full.slice(0, i).trim();
  if (sheet.startsWith("'") && sheet.endsWith("'") && sheet.length >= 2) {
    sheet = sheet.slice(1, -1).replace(/''/g, "'");
  }
  return { sheet, ref: full.slice(i + 1).trim() };
}

/** Marking-scheme cell reference, contract form: "Tab!B7" (tab name unquoted). */
export const sheetCellRef = (sheet: string, ref: string): string => `${sheet}!${ref}`;

/** Row-major comparator for A1 refs (A1 < B1 < A2). Invalid refs sort last. */
export function compareA1(a: string, b: string): number {
  const pa = parseA1(a);
  const pb = parseA1(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b);
  return pa.r - pb.r || pa.c - pb.c;
}
