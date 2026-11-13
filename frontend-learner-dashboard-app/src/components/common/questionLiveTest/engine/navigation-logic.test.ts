import { describe, expect, it } from "vitest";
import {
  canEnterSection,
  isSectionTabAvailable,
  nextTarget,
  previousTarget,
} from "./navigation-logic";

const sections = [
  { question_preview_dto_list: ["a1", "a2"] },
  { question_preview_dto_list: ["b1"] },
  { question_preview_dto_list: ["c1"] },
];

describe("previousTarget", () => {
  it("stays inside the section", () => {
    expect(previousTarget(["a1", "a2"], 1)).toBe("a1");
    expect(previousTarget(["a1", "a2"], 0)).toBeNull();
    expect(previousTarget(["a1", "a2"], -1)).toBeNull();
  });
});

describe("nextTarget", () => {
  it("goes to the next question in the section", () => {
    expect(
      nextTarget({ sections, currentSection: 0, currentIndex: 0, sectionTimers: {} }),
    ).toEqual({ section: 0, question: "a2" });
  });
  it("crosses into the next section when it has time or no clock", () => {
    expect(
      nextTarget({ sections, currentSection: 0, currentIndex: 1, sectionTimers: {} }),
    ).toEqual({ section: 1, question: "b1" });
    expect(
      nextTarget({
        sections,
        currentSection: 0,
        currentIndex: 1,
        sectionTimers: { 1: { timeLeft: 1000 } },
      }),
    ).toEqual({ section: 1, question: "b1" });
  });
  it("does not enter a next section whose time is up, and does not skip it", () => {
    expect(
      nextTarget({
        sections,
        currentSection: 0,
        currentIndex: 1,
        sectionTimers: { 1: { timeLeft: 0 }, 2: { timeLeft: 1000 } },
      }),
    ).toBeNull();
  });
  it("stops on the last question of the test", () => {
    expect(
      nextTarget({ sections, currentSection: 2, currentIndex: 0, sectionTimers: {} }),
    ).toBeNull();
  });
});

describe("section tabs", () => {
  const timers = { 0: { timeLeft: 0 }, 1: { timeLeft: 5000 }, 2: { timeLeft: 5000 } };
  it("with switching, every tab is available but a finished section cannot be entered", () => {
    expect(isSectionTabAvailable(true, 2, timers)).toBe(true);
    expect(canEnterSection(true, 2, timers)).toBe(true);
    expect(canEnterSection(true, 0, timers)).toBe(false);
  });
  it("without switching, only the first section with time is open", () => {
    expect(isSectionTabAvailable(false, 1, timers)).toBe(true);
    expect(canEnterSection(false, 1, timers)).toBe(true);
    expect(isSectionTabAvailable(false, 2, timers)).toBe(false);
    expect(canEnterSection(false, 2, timers)).toBe(false);
  });
  it("the first section is always available; untimed sections are enterable", () => {
    expect(isSectionTabAvailable(false, 0, {})).toBe(true);
    expect(canEnterSection(true, 1, {})).toBe(true);
    // Without switching, an untimed earlier section never counts as done.
    expect(canEnterSection(false, 1, {})).toBe(false);
  });
});
