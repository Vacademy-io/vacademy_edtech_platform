import { describe, expect, it } from "vitest";
import { resolveExamTheme } from "@/components/common/questionLiveTest/themes";
import { instructionTemplateFor } from "./index";

describe("instructionTemplateFor", () => {
  it("keeps today's brief for the default theme and unknown presets", () => {
    expect(instructionTemplateFor(resolveExamTheme(null))).toBe("default");
    expect(instructionTemplateFor(resolveExamTheme({ v: 1, preset: "not-a-preset" }))).toBe(
      "default",
    );
  });

  it.each([
    [{ v: 1, preset: "jee-advanced" }],
    [{ v: 1, preset: "gate" }],
    [{ v: 1, preset: "rrb-je" }],
    [{ v: 1, preset: "jee-main" }],
    [{ v: 1, preset: "jee-main", layout: "tcs-console" }],
    [{ v: 1, preset: "gate", strict: false }],
  ])("gives the console themes the TCS template (%j)", (examInterface: unknown) => {
    expect(instructionTemplateFor(resolveExamTheme(examInterface))).toBe("tcs");
  });
});
