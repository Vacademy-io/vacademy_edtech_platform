import { describe, expect, it } from "vitest";
import {
  bordersToCellFlags,
  cbeSheetSignature,
  cbeToFortune,
  fortuneToCbe,
  hasUncomputedFormulas,
  normalizeCbeSheet,
  type FortuneCell,
  type FortuneSheet,
} from "../fortune-adapter";
import type { CbeSheet } from "../types";

const SAMPLE: CbeSheet = {
  sheets: [
    {
      name: "Consolidated SFP",
      cells: {
        A1: { v: "Parent Co – Consolidated SFP", s: { b: 1, bg: "#1f3864", fc: "#ffffff" } },
        B4: { v: "$000", s: { al: "r", b: 1 } },
        A7: { v: "Goodwill", s: { i: 1 } },
        B7: { v: 3200, f: "=Workings!B41", s: { nf: "#,##0;\\(#,##0\\);\\-" } },
        B8: { v: -900, s: { nf: "#,##0;\\(#,##0\\);\\-", u: 1 } },
        B11: { v: 2300, f: "=SUM(B7:B10)", s: { nf: "#,##0", bt: 1, bb: 1, al: "c" } },
        C11: { s: { bb: 1 } },
        D7: { v: 2, s: { nf: "0.0" } },
        E2: { v: true },
        F3: { v: 0.25, s: { nf: "0%" } },
      },
      colWidths: { A: 276, B: 84, D: 48 },
      merges: ["A1:D1"],
      rowCount: 45,
      colCount: 12,
    },
    {
      name: "Workings",
      cells: { B41: { v: 3200, f: "=B39+B40" }, A41: { v: "Goodwill at 31 March 20X6" } },
      rowCount: 75,
      colCount: 7,
    },
  ],
};

/** Fortune's live sheets carry a dense `data` matrix instead of `celldata`. */
function toDense(sheet: FortuneSheet): FortuneSheet {
  const rows = sheet.row ?? 40;
  const cols = sheet.column ?? 12;
  const data: Array<Array<FortuneCell | null>> = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const { r, c, v } of sheet.celldata ?? []) {
    const row = data[r];
    if (row) row[c] = v;
  }
  const { celldata: _drop, ...rest } = sheet;
  void _drop;
  return { ...rest, data };
}

describe("fortune-adapter", () => {
  it("maps cells, styles, merges and widths to Fortune's model", () => {
    const [sfp, workings] = cbeToFortune(SAMPLE);
    expect(sfp?.name).toBe("Consolidated SFP");
    expect(sfp?.row).toBe(45);
    expect(workings?.order).toBe(1);
    const b7 = sfp?.celldata?.find((x) => x.r === 6 && x.c === 1)?.v;
    expect(b7).toMatchObject({ v: 3200, m: "3,200", f: "=Workings!B41", ct: { fa: "#,##0;\\(#,##0\\);\\-", t: "n" } });
    const b4 = sfp?.celldata?.find((x) => x.r === 3 && x.c === 1)?.v;
    expect(b4).toMatchObject({ bl: 1, ht: 2 });
    expect(sfp?.config?.merge).toEqual({ "0_0": { r: 0, c: 0, rs: 1, cs: 4 } });
    expect(sfp?.celldata?.find((x) => x.r === 0 && x.c === 2)?.v?.mc).toEqual({ r: 0, c: 0 });
    expect(sfp?.config?.columnlen).toEqual({ "0": 276, "1": 84, "3": 48 });
    expect(sfp?.config?.borderInfo).toHaveLength(3);
  });

  it("round-trips CbeSheet -> Fortune (celldata) -> CbeSheet", () => {
    const back = fortuneToCbe(cbeToFortune(SAMPLE));
    expect(normalizeCbeSheet(back)).toEqual(normalizeCbeSheet(SAMPLE));
  });

  it("round-trips through Fortune's dense data matrix (onChange shape)", () => {
    const dense = cbeToFortune(SAMPLE).map(toDense);
    const back = fortuneToCbe(dense);
    expect(cbeSheetSignature(back)).toBe(cbeSheetSignature(SAMPLE));
    // A second trip is stable.
    expect(cbeSheetSignature(fortuneToCbe(cbeToFortune(back).map(toDense)))).toBe(cbeSheetSignature(SAMPLE));
  });

  it("right-aligns figures in the grid without writing an alignment back", () => {
    const [sfp] = cbeToFortune(SAMPLE);
    const at = (r: number, c: number) => sfp?.celldata?.find((x) => x.r === r && x.c === c)?.v;
    expect(at(6, 1)?.ht).toBe(2); // B7 number, no al
    expect(at(10, 1)?.ht).toBe(0); // B11 explicit centre
    expect(at(6, 0)?.ht).toBeUndefined(); // A7 text
    const back = fortuneToCbe([
      { name: "S", order: 0, data: [[{ v: 1, ht: 2 }, { v: "x", ht: 2 }, { v: 2, ht: 1 }]] },
    ]).sheets[0]?.cells;
    expect(back).toEqual({ A1: { v: 1 }, B1: { v: "x", s: { al: "r" } }, C1: { v: 2, s: { al: "l" } } });
  });

  it("keeps tab order by Fortune's `order`, not array position", () => {
    const sheets = cbeToFortune(SAMPLE).reverse();
    expect(fortuneToCbe(sheets).sheets.map((t) => t.name)).toEqual(["Consolidated SFP", "Workings"]);
  });

  it("reads typed values the way Fortune stores them", () => {
    const sheet: FortuneSheet = {
      name: "Sheet1",
      order: 0,
      data: [
        [
          { v: "5", m: "5", ct: { fa: "General", t: "n" } },
          { v: 7, m: "7", ct: { fa: "General", t: "n" } },
          { f: "=A1+B1", v: 12, m: "12", ct: { fa: "General", t: "n" } },
          { ct: { t: "inlineStr", fa: "General", s: [{ v: "Good" }, { v: "will" }] } },
          { v: "", ct: { fa: "General", t: "g" } },
          { bl: 0, it: 0, un: 0, ct: { fa: "General", t: "g" } },
          { v: "x", fc: "#000000" },
        ],
      ],
    };
    const tab = fortuneToCbe([sheet]).sheets[0];
    expect(tab?.cells).toEqual({
      A1: { v: 5 },
      B1: { v: 7 },
      C1: { v: 12, f: "=A1+B1" },
      D1: { v: "Goodwill" },
      G1: { v: "x" },
    });
  });

  it("resolves Fortune border ranges to top/bottom flags, last write wins", () => {
    const flags = bordersToCellFlags([
      { rangeType: "range", borderType: "border-all", range: [{ row: [0, 1], column: [0, 0] }] },
      { rangeType: "range", borderType: "border-bottom", range: [{ row: [3, 4], column: [1, 2] }] },
      { rangeType: "range", borderType: "border-top", range: [{ row: [3, 4], column: [1, 1] }] },
      { rangeType: "range", borderType: "border-outside", range: [{ row: [6, 8], column: [0, 0] }] },
      { rangeType: "range", borderType: "border-none", range: [{ row: [1, 1], column: [0, 0] }] },
      { rangeType: "range", borderType: "border-left", range: [{ row: [9, 9], column: [0, 0] }] },
      { rangeType: "cell", value: { row_index: 10, col_index: 0, t: { style: 1 }, b: { style: 1 } } },
    ]);
    expect(flags.get("0_0")).toEqual({ bt: 1, bb: 1 });
    expect(flags.get("1_0")).toEqual({});
    expect(flags.get("4_1")).toEqual({ bb: 1 });
    expect(flags.get("4_2")).toEqual({ bb: 1 });
    expect(flags.get("3_1")).toEqual({ bt: 1 });
    expect(flags.get("6_0")).toEqual({ bt: 1 });
    expect(flags.get("7_0")).toBeUndefined();
    expect(flags.get("8_0")).toEqual({ bb: 1 });
    expect(flags.get("9_0")).toBeUndefined();
    expect(flags.get("10_0")).toEqual({ bt: 1, bb: 1 });
  });

  it("always yields at least one tab and flags formulas without values", () => {
    expect(cbeToFortune(null)).toHaveLength(1);
    expect(fortuneToCbe([]).sheets).toHaveLength(1);
    expect(hasUncomputedFormulas({ sheets: [{ name: "S", cells: { A1: { f: "=1+1" } } }] })).toBe(true);
    expect(hasUncomputedFormulas(SAMPLE)).toBe(false);
  });
});
