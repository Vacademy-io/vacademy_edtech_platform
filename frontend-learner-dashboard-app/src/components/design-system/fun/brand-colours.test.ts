import { describe, expect, it } from "vitest";
import { contrastRatio, hslChannelsToHex } from "@/lib/colour/contrast";
import { brandNearLiveRed, funBrandColours } from "./brand-colours";

const WHITE = "#ffffff"; // design-lint-ignore: test data

/** The four brands the boards are drawn with, and what the boards' own rule gives. */
const BOARD = [
  { brand: "#2563EB", solid: "#2460e3" }, // design-lint-ignore: test data
  { brand: "#E8590C", solid: "#b44912" }, // design-lint-ignore: test data
  { brand: "#0F8B8D", solid: "#0f7479" }, // design-lint-ignore: test data
  { brand: "#F59E0B", solid: "#916317" }, // design-lint-ignore: test data
];

const EXTREMES = [
  "#ffffff", "#000000", "#ffff00", "#00ff00", "#22d3ee", "#fefefe", "#f43f5e", "#e11d48", "#7c3aed", // design-lint-ignore: test data
];

describe("funBrandColours", () => {
  it.each(BOARD)("matches the board for $brand", ({ brand, solid }: { brand: string; solid: string }) => {
    expect(funBrandColours(brand)!.solid).toBe(solid);
  });
  it.each([...BOARD.map((b) => b.brand), ...EXTREMES])("%s: white on solid and solid on tint both read", (brand: string) => {
    const colours = funBrandColours(brand)!;
    expect(contrastRatio(colours.solid, colours.tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colours.solid, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colours.lip, colours.solid)).toBeGreaterThan(1);
  });
  it("leaves a brand that already reads as it is", () => {
    expect(funBrandColours("#1E40AF")!.solid).toBe("#1e40af"); // design-lint-ignore: test data
  });
  it("reads the channels the theme provider writes", () => {
    expect(funBrandColours(hslChannelsToHex("221 83% 53%"))).not.toBeNull();
  });
  it("is null with no readable brand", () => {
    expect(funBrandColours(null)).toBeNull();
    expect(funBrandColours("nope")).toBeNull();
  });
});

describe("brandNearLiveRed", () => {
  it.each(["#E11D48", "#DC2626", "#F43F5E", "#EC4899", "#c91c44", "#BE123C"])( // design-lint-ignore: test data
    "%s reads as the live red",
    (brand: string) => {
      expect(brandNearLiveRed(brand)).toBe(true);
      expect(brandNearLiveRed(funBrandColours(brand)!.solid)).toBe(true);
    },
  );
  it.each(["#2563EB", "#E8590C", "#0F8B8D", "#F59E0B", "#7c3aed", "#9ca3af", "#ffffff", "#000000"])( // design-lint-ignore: test data
    "%s does not",
    (brand: string) => {
      expect(brandNearLiveRed(brand)).toBe(false);
    },
  );
  it("reads nothing into a missing or unreadable brand", () => {
    expect(brandNearLiveRed(null)).toBe(false);
    expect(brandNearLiveRed("not a colour")).toBe(false);
  });
});
