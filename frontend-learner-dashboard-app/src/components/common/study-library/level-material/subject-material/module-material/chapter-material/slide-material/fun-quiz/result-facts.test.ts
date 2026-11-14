import { describe, expect, it } from "vitest";
import {
  isPlaceholderName,
  joinPlace,
  marksText,
  passTick,
  resultActions,
  resultTiles,
  RING_CIRCUMFERENCE,
  ringDash,
  scorePercent,
  triesLeft,
  verdictOf,
} from "./result-facts";

describe("scorePercent", () => {
  it("rounds earned over total marks, as the standard score card does", () => {
    expect(scorePercent({ earned: 3, totalMarks: 5 })).toBe(60);
    expect(scorePercent({ earned: 1, totalMarks: 3 })).toBe(33);
    expect(scorePercent({ earned: 2, totalMarks: 3 })).toBe(67);
    expect(scorePercent({ earned: 2.5, totalMarks: 5 })).toBe(50);
  });
  it("never goes outside 0 to 100 and survives an empty quiz", () => {
    expect(scorePercent({ earned: 0, totalMarks: 0 })).toBe(0);
    expect(scorePercent(undefined)).toBe(0);
    expect(scorePercent({ earned: -2, totalMarks: 5 })).toBe(0);
    expect(scorePercent({ earned: 7, totalMarks: 5 })).toBe(100);
    expect(scorePercent({ earned: Number.NaN, totalMarks: 5 })).toBe(0);
  });
});

describe("verdictOf", () => {
  it("gives a verdict only when the quiz has a pass mark", () => {
    expect(verdictOf(true, 50)).toBe("passed");
    expect(verdictOf(false, 60)).toBe("notPassed");
    expect(verdictOf(false, 0)).toBe("notPassed");
    expect(verdictOf(null, 60)).toBe("none");
    expect(verdictOf(true, null)).toBe("none");
    expect(verdictOf(undefined, undefined)).toBe("none");
  });
});

describe("resultTiles", () => {
  it("always shows correct and wrong, and partial or skipped only when non-zero", () => {
    expect(resultTiles({ earned: 3, totalMarks: 5, correct: 3, wrong: 2, skipped: 0 })).toEqual([
      { kind: "correct", count: 3 },
      { kind: "wrong", count: 2 },
    ]);
    expect(resultTiles({ earned: 0, totalMarks: 5, correct: 0, wrong: 0, partial: 0, skipped: 5 })).toEqual([
      { kind: "correct", count: 0 },
      { kind: "wrong", count: 0 },
      { kind: "skipped", count: 5 },
    ]);
    expect(resultTiles({ earned: 3, totalMarks: 5, correct: 2, partial: 2, wrong: 0, skipped: 1 }).map((t) => t.kind)).toEqual([
      "correct",
      "wrong",
      "partial",
      "skipped",
    ]);
  });
});

describe("triesLeft", () => {
  it("counts what is left after this attempt, and nothing for unlimited quizzes", () => {
    expect(triesLeft(1, 3)).toBe(2);
    expect(triesLeft(3, 3)).toBe(0);
    expect(triesLeft(5, 3)).toBe(0);
    expect(triesLeft(1, null)).toBeNull();
    expect(triesLeft(undefined, 2)).toBe(2);
  });
});

describe("resultActions", () => {
  it("makes Try again the filled button only for a not-passed result that can be retried", () => {
    expect(resultActions({ verdict: "notPassed", canRetry: true, hasNext: false })).toEqual({ primary: "retry", secondary: "back" });
    expect(resultActions({ verdict: "notPassed", canRetry: true, hasNext: true })).toEqual({ primary: "retry", secondary: "next" });
  });
  it("moves on otherwise, keeping Try again as the outline button while attempts remain", () => {
    expect(resultActions({ verdict: "passed", canRetry: true, hasNext: true })).toEqual({ primary: "next", secondary: "retry" });
    expect(resultActions({ verdict: "none", canRetry: true, hasNext: false })).toEqual({ primary: "back", secondary: "retry" });
  });
  it("hides Try again when attempts have run out", () => {
    expect(resultActions({ verdict: "notPassed", canRetry: false, hasNext: false })).toEqual({ primary: "back", secondary: null });
    expect(resultActions({ verdict: "passed", canRetry: false, hasNext: true })).toEqual({ primary: "next", secondary: null });
  });
});

describe("marksText", () => {
  it("prints up to two decimals and never a negative", () => {
    expect(marksText(3)).toBe("3");
    expect(marksText(2.5)).toBe("2.5");
    expect(marksText(1 / 3)).toBe("0.33");
    expect(marksText(-1)).toBe("0");
    expect(marksText(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("ring geometry", () => {
  it("draws the arc the boards draw: 60% is 233.7 of 389.6", () => {
    expect(ringDash(60)).toBe("233.7 389.6");
    expect(ringDash(20)).toBe("77.9 389.6");
    expect(ringDash(0)).toBe("0 389.6");
    expect(ringDash(140)).toBe(`${Math.round(RING_CIRCUMFERENCE * 10) / 10} 389.6`);
  });
  it("puts the pass-mark tick where A-ResultFail puts it for a 60% pass mark", () => {
    expect(passTick(60)).toEqual({ x1: 42.8, y1: 116.9, x2: 32.3, y2: 131.4 });
  });
  it("puts a 50% tick straight down and a 0% tick straight up", () => {
    expect(passTick(50)).toEqual({ x1: 74, y1: 127, x2: 74, y2: 145 });
    expect(passTick(0)).toEqual({ x1: 74, y1: 21, x2: 74, y2: 3 });
  });
});

describe("place names", () => {
  it("leaves out missing and placeholder names", () => {
    expect(isPlaceholderName("DEFAULT")).toBe(true);
    expect(isPlaceholderName(" default ")).toBe(true);
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName("Physics")).toBe(false);
    expect(joinPlace("Physics", "Lenses and mirrors")).toBe("Physics · Lenses and mirrors");
    expect(joinPlace("default", "Lenses and mirrors")).toBe("Lenses and mirrors");
    expect(joinPlace(null, undefined, "")).toBe("");
  });
});
