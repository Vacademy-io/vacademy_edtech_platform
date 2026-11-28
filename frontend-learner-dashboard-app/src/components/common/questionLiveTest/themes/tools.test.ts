import { describe, expect, it } from "vitest";
import { DEFAULT_EXAM_EXPERIENCE } from "@/types/assessment-experience";
import { resolveExamTheme, DEFAULT_EXAM_THEME } from "./index";
import { withThemeTools } from "./tools";

const off = DEFAULT_EXAM_EXPERIENCE; // calculator off by default

describe("built-in calculator", () => {
  it("GATE gets the scientific calculator even when the institute turned it off", () => {
    const theme = resolveExamTheme({ v: 1, preset: "gate" });
    expect(theme.builtInCalculator).toBe("scientific");
    expect(withThemeTools(off, theme).calculator).toEqual({ enabled: true, mode: "scientific" });
  });

  it("a GATE test can turn it off", () => {
    const theme = resolveExamTheme({ v: 1, preset: "gate", tools: { calculator: false } });
    expect(theme.builtInCalculator).toBeNull();
    expect(withThemeTools(off, theme)).toBe(off);
  });

  it("practice-friendly GATE keeps the calculator", () => {
    const theme = resolveExamTheme({ v: 1, preset: "gate", strict: false });
    expect(theme.builtInCalculator).toBe("scientific");
  });

  it("other themes and the default screen leave the institute setting alone", () => {
    expect(DEFAULT_EXAM_THEME.builtInCalculator).toBeNull();
    for (const preset of ["jee-main", "jee-advanced", "rrb-je"]) {
      const theme = resolveExamTheme({ v: 1, preset });
      expect(theme.builtInCalculator).toBeNull();
      expect(withThemeTools(off, theme)).toBe(off);
    }
  });

  it("keeps the same object when the institute already has the scientific calculator", () => {
    const on = { ...off, calculator: { enabled: true, mode: "scientific" as const } };
    expect(withThemeTools(on, resolveExamTheme({ v: 1, preset: "gate" }))).toBe(on);
  });
});
