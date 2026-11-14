import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, hslChannelsToHex, mixHex, readableBrand } from "./contrast";

const WHITE = "#ffffff"; // design-lint-ignore

describe("hexToRgb", () => {
  it("reads six and three digit forms, with or without #", () => {
    expect(hexToRgb("#1F2333")).toEqual([31, 35, 51]); // design-lint-ignore
    expect(hexToRgb("fff")).toEqual([255, 255, 255]);
  });
  it("rejects anything else", () => {
    for (const value of ["", "string", "#12345", null, undefined]) expect(hexToRgb(value)).toBeNull();
  });
});

describe("hslChannelsToHex", () => {
  it("reads what the theme provider writes", () => {
    expect(hslChannelsToHex("0 100% 50%")).toBe("#ff0000"); // design-lint-ignore
    expect(hslChannelsToHex(" 120 100% 25% ")).toBe("#008000"); // design-lint-ignore
    expect(hslChannelsToHex("240, 100%, 50%")).toBe("#0000ff"); // design-lint-ignore
  });
  it("wraps hue, as a hue-shifted ramp can overrun", () => {
    expect(hslChannelsToHex("-120 100% 50%")).toBe("#0000ff"); // design-lint-ignore
    expect(hslChannelsToHex("480 100% 50%")).toBe("#00ff00"); // design-lint-ignore
  });
  it("rejects anything else", () => {
    for (const value of ["", "string", "#ff0000", null, undefined]) { // design-lint-ignore
      expect(hslChannelsToHex(value)).toBeNull();
    }
  });
});

describe("contrastRatio", () => {
  it("matches known pairs", () => {
    expect(contrastRatio(WHITE, "#000000")).toBeCloseTo(21, 1); // design-lint-ignore
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
    // The spec board's own figures.
    expect(contrastRatio("#1F2333", WHITE)).toBeCloseTo(15.6, 1); // design-lint-ignore
    expect(contrastRatio("#5B6275", WHITE)).toBeCloseTo(6.09, 2); // design-lint-ignore
    expect(contrastRatio("#E11D48", WHITE)).toBeCloseTo(4.7, 1); // design-lint-ignore
  });
  it("counts unreadable input as no contrast", () => {
    expect(contrastRatio("string", "#000000")).toBe(1); // design-lint-ignore
  });
});

describe("mixHex", () => {
  it("rounds each channel the way the boards do", () => {
    expect(mixHex("#2563EB", WHITE, 0.88)).toBe("#e5ecfd"); // design-lint-ignore
    expect(mixHex("#000000", WHITE, 0.5)).toBe("#808080"); // design-lint-ignore
  });
  it("is null for unreadable input", () => {
    expect(mixHex("nope", WHITE, 0.5)).toBeNull();
  });
});

describe("readableBrand", () => {
  const channels = [
    "221 83% 53%", // blue
    "197 58% 68%", // a light blue
    "45 100% 51%", // amber
    "60 100% 50%", // yellow
    "0 0% 100%", // white
    "0 0% 0%", // black
    "271 76% 53%", // violet
  ];
  it("gives white text at least 4.5:1 on any brand, the pale ones included", () => {
    for (const value of channels) {
      expect(contrastRatio(readableBrand(hslChannelsToHex(value), WHITE, 4.5), WHITE)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("leaves a brand that already reads exactly as it is", () => {
    const blue = hslChannelsToHex("221 83% 53%")!;
    expect(readableBrand(blue, WHITE, 4.5)).toBe(blue);
  });
  it("darkens a pale amber only as far as it needs, keeping its hue", () => {
    const amber = readableBrand(hslChannelsToHex("38 92% 50%"), WHITE, 4.5);
    expect(contrastRatio(amber, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(amber, WHITE)).toBeLessThan(5);
    const [r, g, b] = hexToRgb(amber)!;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });
  it("has a readable colour when no brand can be read", () => {
    expect(contrastRatio(readableBrand(null, WHITE, 4.5), WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readableBrand("nope", WHITE, 4.5), WHITE)).toBeGreaterThanOrEqual(4.5);
  });
});
