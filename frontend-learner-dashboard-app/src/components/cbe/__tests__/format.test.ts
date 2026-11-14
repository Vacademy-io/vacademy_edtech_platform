import { describe, expect, it } from "vitest";
import { adjustDecimals, formatCbeCell, formatCbeValue, formatNumber } from "../format";

const ACCOUNTING = "#,##0;\\(#,##0\\);\\-";

describe("formatNumber", () => {
  it("renders General", () => {
    expect(formatNumber(3200)).toBe("3200");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(-5, "General")).toBe("-5");
  });

  it("renders thousands and decimals", () => {
    expect(formatNumber(3200, "#,##0")).toBe("3,200");
    expect(formatNumber(1234567.891, "#,##0.00")).toBe("1,234,567.89");
    expect(formatNumber(-1234.5, "#,##0")).toBe("-1,235");
    expect(formatNumber(0, "#,##0")).toBe("0");
    expect(formatNumber(2, "0.0")).toBe("2.0");
    expect(formatNumber(0.5, "0.0")).toBe("0.5");
  });

  it("renders the accounting three-section format", () => {
    expect(formatNumber(3200, ACCOUNTING)).toBe("3,200");
    expect(formatNumber(-900, ACCOUNTING)).toBe("(900)");
    expect(formatNumber(0, ACCOUNTING)).toBe("-");
  });

  it("renders percentages, currency tags and thousand scaling", () => {
    expect(formatNumber(0.25, "0%")).toBe("25%");
    expect(formatNumber(0.125, "0.0%")).toBe("12.5%");
    expect(formatNumber(1500, "[$£-809]#,##0")).toBe("£1,500");
    expect(formatNumber(1500, '"$"#,##0.00')).toBe("$1,500.00");
    expect(formatNumber(3200000, "#,##0,")).toBe("3,200");
  });

  it("falls back to General for dates and scientific", () => {
    expect(formatNumber(45000, "dd/mm/yyyy")).toBe("45000");
    expect(formatNumber(12345, "0.00E+00")).toBe("12345");
  });
});

describe("formatCbeValue / formatCbeCell", () => {
  it("formats every value kind", () => {
    expect(formatCbeValue(undefined)).toBe("");
    expect(formatCbeValue(null)).toBe("");
    expect(formatCbeValue(true)).toBe("TRUE");
    expect(formatCbeValue("Goodwill")).toBe("Goodwill");
    expect(formatCbeCell({ v: 3200, f: "=Workings!B41", s: { nf: ACCOUNTING } })).toBe("3,200");
    expect(formatCbeCell(undefined)).toBe("");
  });
});

describe("adjustDecimals", () => {
  it("adds and removes decimals in every section", () => {
    expect(adjustDecimals("#,##0", 1)).toBe("#,##0.0");
    expect(adjustDecimals("#,##0.0", 1)).toBe("#,##0.00");
    expect(adjustDecimals("#,##0.00", -1)).toBe("#,##0.0");
    expect(adjustDecimals("#,##0.0", -1)).toBe("#,##0");
    expect(adjustDecimals("#,##0", -1)).toBe("#,##0");
    expect(adjustDecimals("0%", 1)).toBe("0.0%");
    expect(adjustDecimals("0.0%", -1)).toBe("0%");
    expect(adjustDecimals(undefined, 1)).toBe("0.0");
    expect(adjustDecimals("General", 1)).toBe("0.0");
    expect(adjustDecimals(ACCOUNTING, 1)).toBe("#,##0.0;\\(#,##0.0\\);\\-");
  });
});
