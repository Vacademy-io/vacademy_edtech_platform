import { describe, expect, it, vi } from "vitest";

const COLOUR = vi.hoisted(() => ({
  site: "#7A2E00", // design-lint-ignore
  theme: "#8E24AA", // design-lint-ignore
  fallback: "#ED7424", // design-lint-ignore
  custom: "#0B6E4F", // design-lint-ignore
}));

vi.mock("@/services/domain-routing", () => ({
  resolveThemeHex: (code?: string | null) =>
    ({ purple: COLOUR.theme, primary: COLOUR.fallback } as Record<string, string>)[code ?? ""] ??
    (code?.startsWith("#") ? code : null),
}));

import { siteScaleVars } from "./catalogue-theme";
import { buildPrimaryScaleVars } from "./style-utils";

const STOPS = ["50", "100", "200", "300", "400", "500"].map((s) => `--primary-${s}`);
const hueOf = (hsl: string) => hsl.split(" ")[0];

describe("siteScaleVars", () => {
  it("adds nothing but the site colour for anyone not visiting from another institute", () => {
    expect(siteScaleVars(COLOUR.site, false, "purple")).toEqual(buildPrimaryScaleVars(COLOUR.site));
    expect(siteScaleVars(COLOUR.site, undefined, "purple")).toEqual(buildPrimaryScaleVars(COLOUR.site));
    expect(siteScaleVars(undefined, false, "purple")).toEqual({});
    expect(siteScaleVars(null, undefined, null)).toEqual({});
  });

  it("gives a visitor every stop of the institute's theme when the site has no colour", () => {
    const vars = siteScaleVars(undefined, true, "purple");
    for (const stop of STOPS) expect(vars[stop]).toBeTruthy();
    expect(new Set(STOPS.map((s) => hueOf(vars[s]))).size).toBe(1);
    expect(vars["--primary"]).toBe(vars["--primary-500"]);
    expect(vars["--primary-foreground"]).toBeTruthy();
  });

  it("gives a visitor the site's colour over the institute's theme, --primary included", () => {
    expect(siteScaleVars(COLOUR.site, true, "purple")).toEqual({
      ...buildPrimaryScaleVars(COLOUR.site),
      "--primary": buildPrimaryScaleVars(COLOUR.site)["--primary-500"],
    });
  });

  it.each([[""], ["not-a-colour"], ["short-hex"]])(
    "falls back to the institute's theme when the site colour is %j",
    (colour: string) => {
      const value = colour === "short-hex" ? COLOUR.theme.slice(0, 4) : colour;
      expect(siteScaleVars(value, true, "purple")["--primary-500"]).toBe(
        buildPrimaryScaleVars(COLOUR.theme)["--primary-500"],
      );
    },
  );

  it("accepts an institute theme stored as a custom hex", () => {
    expect(siteScaleVars(undefined, true, COLOUR.custom)["--primary-500"]).toBe(
      buildPrimaryScaleVars(COLOUR.custom)["--primary-500"],
    );
  });

  it.each([[null], [undefined], ["unknown-code"]])(
    "uses the default theme for a visitor when the institute's theme is %j",
    (code: string | null | undefined) => {
      expect(siteScaleVars(undefined, true, code)["--primary-500"]).toBe(
        buildPrimaryScaleVars(COLOUR.fallback)["--primary-500"],
      );
    },
  );
});
