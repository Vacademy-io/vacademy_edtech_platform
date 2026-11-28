import { describe, expect, it } from "vitest";
import {
  hasExamTheme,
  hasVisiblePassage,
  passageBesideQuestion,
  shouldSplitPassage,
  withoutExamTheme,
} from "./passage-beside";

const on = { v: 1, preset: "default", passage_beside_question: true };
const passage = "<p>Read the passage.</p>";

describe("passage beside the question", () => {
  it("is on only when exam_interface says exactly true", () => {
    expect(passageBesideQuestion(on)).toBe(true);
    expect(passageBesideQuestion({ passage_beside_question: true })).toBe(true);
    for (const value of [
      null,
      undefined,
      "x",
      [],
      {},
      { v: 1, preset: "jee-main", layout: "nta-mock", strict: true },
      { passage_beside_question: false },
      { passage_beside_question: "true" },
      { passage_beside_question: 1 },
    ]) {
      expect(passageBesideQuestion(value)).toBe(false);
    }
  });

  it("knows a themed screen from the default one", () => {
    expect(hasExamTheme({ preset: "jee-advanced" })).toBe(true);
    expect(hasExamTheme(on)).toBe(false);
    expect(hasExamTheme({ passage_beside_question: true })).toBe(false);
    expect(hasExamTheme(null)).toBe(false);
  });

  it("drops a theme but keeps the default screen's option (manual papers)", () => {
    expect(withoutExamTheme({ preset: "gate", strict: true })).toBeNull();
    expect(withoutExamTheme({ preset: "gate", passage_beside_question: true })).toEqual({
      passage_beside_question: true,
    });
    expect(withoutExamTheme(null)).toBeNull();
  });

  it("treats empty markup as no passage", () => {
    expect(hasVisiblePassage(passage)).toBe(true);
    expect(hasVisiblePassage('<p><img src="a.png"></p>')).toBe(true);
    expect(hasVisiblePassage("<table><tr><td></td></tr></table>")).toBe(true);
    expect(hasVisiblePassage("<p>&nbsp;</p>")).toBe(false);
    expect(hasVisiblePassage("<p> </p>")).toBe(false);
    expect(hasVisiblePassage("")).toBe(false);
    expect(hasVisiblePassage(null)).toBe(false);
  });

  it("splits only on wide screens, with the option on, a passage, and not for CBE", () => {
    const base = { examInterface: on, isCompact: false, isCbe: false, passageHtml: passage };
    expect(shouldSplitPassage(base)).toBe(true);
    expect(shouldSplitPassage({ ...base, isCompact: true })).toBe(false);
    expect(shouldSplitPassage({ ...base, isCbe: true })).toBe(false);
    expect(shouldSplitPassage({ ...base, passageHtml: undefined })).toBe(false);
    expect(shouldSplitPassage({ ...base, passageHtml: "<p></p>" })).toBe(false);
    // Existing tests: no option, no change.
    expect(shouldSplitPassage({ ...base, examInterface: null })).toBe(false);
    expect(shouldSplitPassage({ ...base, examInterface: { preset: "gate" } })).toBe(false);
  });
});
