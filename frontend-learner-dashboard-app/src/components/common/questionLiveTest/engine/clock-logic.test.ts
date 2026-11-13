import { describe, expect, it } from "vitest";
import { distribution_duration_types } from "@/types/assessment";
import {
  entireTimerTone,
  formatHms,
  formatSectionClock,
  isQuestionClockActive,
  isSectionClockActive,
  questionTickAction,
  remainingFromServerStart,
  sectionTickAction,
  shouldAutoSubmitOnTimeUp,
  shouldAutoSubmitOnViolation,
  shouldAutosave,
  shouldShowEntireTimer,
  type TimeUpInput,
} from "./clock-logic";

const { SECTION, QUESTION, ASSESSMENT } = distribution_duration_types;

describe("sectionTickAction", () => {
  it("counts down by one second", () => {
    expect(sectionTickAction({ timeLeft: 5000 }, false)).toEqual({
      type: "tick",
      timeLeft: 4000,
    });
  });
  it("moves on at 0 when switching is off", () => {
    expect(sectionTickAction({ timeLeft: 0 }, false)).toEqual({ type: "advance" });
    expect(sectionTickAction(undefined, false)).toEqual({ type: "advance" });
  });
  it("waits at 0 when the learner may switch sections", () => {
    expect(sectionTickAction({ timeLeft: 0 }, true)).toEqual({ type: "none" });
  });
  it("does not clamp a timer that is not a whole second (unchanged rule)", () => {
    expect(sectionTickAction({ timeLeft: 500 }, true)).toEqual({
      type: "tick",
      timeLeft: -500,
    });
  });
});

describe("questionTickAction", () => {
  it("counts down, then advances at 0 or when missing", () => {
    expect(questionTickAction(2000)).toEqual({ type: "tick", timeLeft: 1000 });
    expect(questionTickAction(0)).toEqual({ type: "advance" });
    expect(questionTickAction(undefined)).toEqual({ type: "advance" });
  });
});

describe("clock activity", () => {
  it("section clock runs only for SECTION distribution and a timed play mode", () => {
    expect(isSectionClockActive(SECTION, "EXAM")).toBe(true);
    expect(isSectionClockActive(SECTION, "")).toBe(true);
    expect(isSectionClockActive(SECTION, "practice")).toBe(false);
    expect(isSectionClockActive(SECTION, "SURVEY")).toBe(false);
    expect(isSectionClockActive(QUESTION, "EXAM")).toBe(false);
    expect(isSectionClockActive(undefined, "EXAM")).toBe(false);
  });
  it("question clock runs only for QUESTION distribution, a question, and not PRACTICE/SURVEY", () => {
    expect(isQuestionClockActive(QUESTION, "EXAM", true)).toBe(true);
    expect(isQuestionClockActive(QUESTION, "", true)).toBe(true);
    expect(isQuestionClockActive(QUESTION, "EXAM", false)).toBe(false);
    expect(isQuestionClockActive(QUESTION, "PRACTICE", true)).toBe(false);
    expect(isQuestionClockActive(ASSESSMENT, "EXAM", true)).toBe(false);
  });
});

describe("remainingFromServerStart", () => {
  const start = Date.UTC(2026, 0, 1, 10, 0, 0);
  it("subtracts whole elapsed seconds from the duration", () => {
    expect(remainingFromServerStart(3600, start, start + 61_900)).toBe(3539);
  });
  it("never goes below 0", () => {
    expect(remainingFromServerStart(60, start, start + 120_000)).toBe(0);
  });
  it("skips when there is no duration or the start time is invalid", () => {
    expect(remainingFromServerStart(0, start, start)).toBeNull();
    expect(remainingFromServerStart(60, Number.NaN, start)).toBeNull();
  });
});

describe("shouldAutoSubmitOnTimeUp", () => {
  const base: TimeUpInput = {
    hasAssessment: true,
    evaluationType: "AUTO",
    playMode: "EXAM",
    isSubmitted: false,
    entireTestTimer: 0,
    alreadyAutoSubmitted: false,
  };
  it("submits a loaded, timed, unsubmitted test at 0", () => {
    expect(shouldAutoSubmitOnTimeUp(base)).toBe(true);
  });
  it.each<[string, Partial<TimeUpInput>]>([
    ["not loaded", { hasAssessment: false }],
    ["MANUAL", { evaluationType: "MANUAL" }],
    ["play mode not read yet", { playMode: "" }],
    ["practice", { playMode: "PRACTICE" }],
    ["survey (any case)", { playMode: "survey" }],
    ["already submitted", { isSubmitted: true }],
    ["time left", { entireTestTimer: 1 }],
    ["already auto-submitted", { alreadyAutoSubmitted: true }],
  ])("does not submit when %s", (_: string, patch: Partial<TimeUpInput>) => {
    expect(shouldAutoSubmitOnTimeUp({ ...base, ...patch })).toBe(false);
  });
});

describe("shouldAutoSubmitOnViolation", () => {
  const base = {
    hasAssessment: true,
    evaluationType: "AUTO",
    tabSwitchCount: 0,
    proctorAutoSubmitRequested: false,
  };
  it("submits at the third tab switch or on the proctoring ceiling", () => {
    expect(shouldAutoSubmitOnViolation({ ...base, tabSwitchCount: 2 })).toBe(false);
    expect(shouldAutoSubmitOnViolation({ ...base, tabSwitchCount: 3 })).toBe(true);
    expect(
      shouldAutoSubmitOnViolation({ ...base, proctorAutoSubmitRequested: true }),
    ).toBe(true);
  });
  it("never for MANUAL or before the test loads", () => {
    expect(
      shouldAutoSubmitOnViolation({ ...base, tabSwitchCount: 5, evaluationType: "MANUAL" }),
    ).toBe(false);
    expect(
      shouldAutoSubmitOnViolation({ ...base, tabSwitchCount: 5, hasAssessment: false }),
    ).toBe(false);
  });
});

describe("shouldAutosave", () => {
  it("saves a running timed attempt and any untimed attempt", () => {
    expect(shouldAutosave({ isSubmitted: false, entireTestTimer: 10, playMode: "EXAM" })).toBe(true);
    expect(shouldAutosave({ isSubmitted: false, entireTestTimer: 0, playMode: "PRACTICE" })).toBe(true);
  });
  it("stops after submit or when a timed attempt is at 0", () => {
    expect(shouldAutosave({ isSubmitted: true, entireTestTimer: 10, playMode: "EXAM" })).toBe(false);
    expect(shouldAutosave({ isSubmitted: false, entireTestTimer: 0, playMode: "EXAM" })).toBe(false);
  });
});

describe("header clock", () => {
  it("is hidden for PRACTICE/SURVEY and at 0", () => {
    expect(shouldShowEntireTimer("EXAM", 10)).toBe(true);
    expect(shouldShowEntireTimer("PRACTICE", 10)).toBe(false);
    expect(shouldShowEntireTimer("EXAM", 0)).toBe(false);
  });
  it("turns warning at 15 % and danger at 5 % of the duration", () => {
    expect(entireTimerTone(600, 60)).toBe("neutral");
    expect(entireTimerTone(540, 60)).toBe("warning");
    expect(entireTimerTone(180, 60)).toBe("danger");
    expect(entireTimerTone(100, 0)).toBe("neutral");
  });
  it("formats HH:MM:SS and MM:SS", () => {
    expect(formatHms(3725)).toBe("01:02:05");
    expect(formatHms(0)).toBe("00:00:00");
    expect(formatSectionClock(125_000)).toBe("02:05");
    expect(formatSectionClock(0)).toBe("00:00");
  });
});
