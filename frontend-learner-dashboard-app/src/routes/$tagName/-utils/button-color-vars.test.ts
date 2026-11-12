import { describe, expect, it } from "vitest";
import { buildButtonColorVars, buildComponentStyle, buildSectionShellStyles } from "./catalogue-style-engine";

/** Style → Buttons: a section's own button colour, as CSS variables read by .catalogue-btn-primary. */
describe("section button colour", () => {
  it("nothing set → no variables (site primary colour stays)", () => {
    expect(buildButtonColorVars({})).toEqual({});
    expect(buildComponentStyle({ paddingTop: "8px" })).not.toHaveProperty("--catalogue-btn-bg");
  });

  it("a colour sets the fill and a readable ink", () => {
    expect(buildButtonColorVars({ buttonColor: "#1E2A4A" })).toEqual({
      "--catalogue-btn-bg": "#1E2A4A",
      "--catalogue-btn-ink": "#ffffff",
    });
    expect(buildButtonColorVars({ buttonColor: "#F9E79F" })).toMatchObject({ "--catalogue-btn-ink": "#111827" });
  });

  it("an authored text colour wins; a non-hex fill gets no guessed ink", () => {
    expect(buildButtonColorVars({ buttonColor: "#1E2A4A", buttonTextColor: "#FFD700" })).toMatchObject({
      "--catalogue-btn-ink": "#FFD700",
    });
    expect(buildButtonColorVars({ buttonColor: "rgb(1,2,3)" })).toEqual({ "--catalogue-btn-bg": "rgb(1,2,3)" });
  });

  it("reaches the wrapper on both plain and section-shell rendering", () => {
    expect(buildComponentStyle({ buttonColor: "#075E54" })).toMatchObject({ "--catalogue-btn-bg": "#075E54" });
    const { canvasStyle } = buildSectionShellStyles({ layout: { width: "default" }, buttonColor: "#075E54" });
    expect(canvasStyle).toMatchObject({ "--catalogue-btn-bg": "#075E54" });
  });
});
