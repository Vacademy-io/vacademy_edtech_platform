import { describe, expect, it } from "vitest";
import {
  colToLetters,
  compareA1,
  lettersToCol,
  parseA1,
  parseRange,
  rangeToA1,
  sheetCellRef,
  splitSheetRef,
  toA1,
} from "../a1";

describe("a1", () => {
  it("converts column indexes and letters both ways", () => {
    expect(colToLetters(0)).toBe("A");
    expect(colToLetters(25)).toBe("Z");
    expect(colToLetters(26)).toBe("AA");
    expect(colToLetters(701)).toBe("ZZ");
    expect(colToLetters(702)).toBe("AAA");
    for (let c = 0; c < 2000; c += 1) expect(lettersToCol(colToLetters(c))).toBe(c);
    expect(lettersToCol("b")).toBe(1);
    expect(lettersToCol("1A")).toBe(-1);
    expect(() => colToLetters(-1)).toThrow();
  });

  it("parses and prints A1 refs (0-based)", () => {
    expect(toA1(6, 1)).toBe("B7");
    expect(parseA1("B7")).toEqual({ r: 6, c: 1 });
    expect(parseA1("$B$41")).toEqual({ r: 40, c: 1 });
    expect(parseA1("b7")).toEqual({ r: 6, c: 1 });
    expect(parseA1("B0")).toBeNull();
    expect(parseA1("Sheet1!B7")).toBeNull();
    expect(parseA1("")).toBeNull();
  });

  it("parses ranges and normalises corners", () => {
    expect(parseRange("A1:C1")).toEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
    expect(parseRange("C3:A1")).toEqual({ s: { r: 0, c: 0 }, e: { r: 2, c: 2 } });
    expect(parseRange("B2")).toEqual({ s: { r: 1, c: 1 }, e: { r: 1, c: 1 } });
    expect(parseRange("A1:?")).toBeNull();
    expect(rangeToA1({ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } })).toBe("A1:D1");
  });

  it("splits sheet-qualified refs", () => {
    expect(splitSheetRef("Consolidated SFP!B7")).toEqual({ sheet: "Consolidated SFP", ref: "B7" });
    expect(splitSheetRef("'Tom''s tab'!C2")).toEqual({ sheet: "Tom's tab", ref: "C2" });
    expect(splitSheetRef("B7")).toEqual({ sheet: null, ref: "B7" });
    expect(sheetCellRef("Consolidated SFP", "B7")).toBe("Consolidated SFP!B7");
  });

  it("sorts refs row-major", () => {
    expect(["B2", "A2", "C1", "A10", "A1"].sort(compareA1)).toEqual(["A1", "C1", "A2", "B2", "A10"]);
  });
});
