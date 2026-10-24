import { describe, expect, it } from "vitest";
import {
  PALETTE_KEYS,
  buildContentWidthVars,
  buildPaletteVars,
  buildSiteThemeVars,
  hexToHslChannels,
  paletteVarName,
  resolveContentMaxWidth,
  withSiteThemeVars,
} from "./catalogue-palette";

const BV = {
  text: "#1a1208", // design-lint-ignore
  body: "#463d2d", // design-lint-ignore
  primary: "#883000", // design-lint-ignore
  sand: "#f5eac9", // design-lint-ignore
  borderStrong: "#e0d2ae", // design-lint-ignore
};

describe("hexToHslChannels", () => {
  it("converts #rrggbb and #rgb to the catalogue channel form", () => {
    expect(hexToHslChannels("#ffffff")).toBe("0 0% 100%"); // design-lint-ignore
    expect(hexToHslChannels("#000")).toBe("0 0% 0%"); // design-lint-ignore
    expect(hexToHslChannels(" #883000 ")).toBe("21.2 100% 26.7%"); // design-lint-ignore
  });
  it("rejects anything that is not hex", () => {
    for (const bad of ["red", "#12", "#12345", "rgb(0,0,0)", "", null, 12, "#aabbccdd"]) {
      expect(hexToHslChannels(bad)).toBeNull();
    }
  });
});

describe("buildPaletteVars", () => {
  it("is empty without a palette", () => {
    expect(buildPaletteVars(undefined)).toEqual({});
    expect(buildPaletteVars(null)).toEqual({});
    expect(buildPaletteVars("x")).toEqual({});
    expect(buildPaletteVars({ text: "red" })).toEqual({});
  });
  it("sets one --palette-* channel var per valid colour, kebab-cased", () => {
    const vars = buildPaletteVars({ ...BV, gold: "nope" });
    expect(Object.keys(vars).sort()).toEqual(
      ["--palette-body", "--palette-border-strong", "--palette-primary", "--palette-sand", "--palette-text"].sort(),
    );
    expect(vars["--palette-text"]).toBe(hexToHslChannels(BV.text));
    expect(paletteVarName("muted2")).toBe("--palette-muted2");
    expect(PALETTE_KEYS).toHaveLength(16); // 13 foundation + 3 chrome (accentOnDark, bodyOnDark, outline)
  });
  it("re-points the shared catalogue tokens only with applyToTokens, and never in dark mode", () => {
    expect(buildPaletteVars(BV)["--catalogue-text-primary"]).toBeUndefined();
    const light = buildPaletteVars({ ...BV, applyToTokens: true });
    expect(light["--catalogue-text-primary"]).toBe(hexToHslChannels(BV.text));
    expect(light["--catalogue-text-secondary"]).toBe(hexToHslChannels(BV.body));
    expect(light["--catalogue-bg-muted"]).toBe(hexToHslChannels(BV.sand));
    expect(light["--catalogue-border-strong"]).toBe(hexToHslChannels(BV.borderStrong));
    const dark = buildPaletteVars({ ...BV, applyToTokens: true }, { mode: "dark" });
    expect(dark["--catalogue-text-primary"]).toBeUndefined();
    expect(dark["--palette-text"]).toBe(hexToHslChannels(BV.text));
  });
});

describe("content width", () => {
  it("accepts a px number (or numeric string) between 320 and 2400", () => {
    expect(resolveContentMaxWidth(1152)).toBe(1152);
    expect(resolveContentMaxWidth("1152")).toBe(1152);
    expect(resolveContentMaxWidth(1152.4)).toBe(1152);
    for (const bad of [undefined, null, "", "1152px", 100, 5000, NaN, {}]) {
      expect(resolveContentMaxWidth(bad)).toBeNull();
    }
  });
  it("widens the shell by its lg gutters so content is exactly n px", () => {
    expect(buildContentWidthVars(1152)).toEqual({
      "--site-content-max": "1152px",
      "--catalogue-content-max": "1216px",
    });
    expect(buildContentWidthVars(null)).toEqual({});
  });
});

describe("site theme vars on the page wrapper", () => {
  it("is undefined for a site without palette or width — the wrapper style stays the same object", () => {
    const base = { "--primary-500": "1 2% 3%" };
    for (const gs of [undefined, null, {}, { theme: { preset: "default", primaryColor: "#883000" } }, { theme: { palette: {} } }]) { // design-lint-ignore
      expect(buildSiteThemeVars(gs as never)).toBeUndefined();
      expect(withSiteThemeVars(base, gs as never)).toBe(base);
    }
    expect(withSiteThemeVars(undefined, {})).toBeUndefined();
  });
  it("merges palette and width vars when the site sets them", () => {
    const style = withSiteThemeVars({ a: "1" }, { theme: { palette: BV, contentMaxWidth: 1152 } });
    expect(style).toMatchObject({
      a: "1",
      "--palette-text": hexToHslChannels(BV.text),
      "--catalogue-content-max": "1216px",
    });
  });
});
