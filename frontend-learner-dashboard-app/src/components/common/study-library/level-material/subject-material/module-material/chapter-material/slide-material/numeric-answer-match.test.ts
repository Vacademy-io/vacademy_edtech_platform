import { describe, expect, it } from "vitest";
import {
  isWithinTolerance,
  numericToleranceVerdict,
  parseNumericAnswer,
  readNumericToleranceKey,
} from "./numeric-answer-match";

const quizKey = (answers: unknown[], tolerance?: unknown) =>
  JSON.stringify({ correctAnswers: answers, ...(tolerance === undefined ? {} : { tolerance }) });
const dataKey = (answers: unknown[], tolerance?: unknown) =>
  JSON.stringify({
    type: "NUMERIC",
    data: { validAnswers: answers, ...(tolerance === undefined ? {} : { tolerance }) },
  });

describe("numericToleranceVerdict", () => {
  it("accepts answers within the tolerance and rejects the rest", () => {
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], 1), 1251)).toBe(true);
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], 1), "1249")).toBe(true);
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], 1), 1251.5)).toBe(false);
    expect(numericToleranceVerdict("CNUMERIC", dataKey([3.14], 0.01), "3.15")).toBe(true);
    expect(numericToleranceVerdict("NUMERIC", dataKey([3.14], 0.01), "3.151")).toBe(false);
  });

  it("counts the exact boundary despite floating point", () => {
    expect(numericToleranceVerdict("NUMERIC", quizKey([0.1], 1), 1.1)).toBe(true);
    expect(numericToleranceVerdict("NUMERIC", quizKey([100], 0.5), 99.5)).toBe(true);
  });

  it("handles negative numbers", () => {
    expect(numericToleranceVerdict("NUMERIC", quizKey([-500], 2), -502)).toBe(true);
    expect(numericToleranceVerdict("NUMERIC", quizKey([-500], 2), "-497.9")).toBe(false);
  });

  it("ignores spaces and thousands separators", () => {
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], 1), "1,251")).toBe(true);
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], 1), " 1 250 ")).toBe(true);
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], 1), "abc")).toBe(false);
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], 1), "")).toBe(false);
  });

  it("leaves the old rule in charge without a tolerance", () => {
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250]), 1251)).toBeNull();
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], 0), 1251)).toBeNull();
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], -1), 1251)).toBeNull();
    expect(numericToleranceVerdict("NUMERIC", quizKey([1250], null), 1251)).toBeNull();
    expect(numericToleranceVerdict("NUMERIC", undefined, 1251)).toBeNull();
    expect(numericToleranceVerdict("NUMERIC", "not json", 1251)).toBeNull();
  });

  it("only applies to numeric questions", () => {
    expect(numericToleranceVerdict("MCQS", quizKey([1], 1), 2)).toBeNull();
    expect(numericToleranceVerdict(undefined, quizKey([1], 1), 2)).toBeNull();
  });
});

describe("helpers", () => {
  it("parses typed answers", () => {
    expect(parseNumericAnswer("1,250.5")).toBe(1250.5);
    expect(parseNumericAnswer(7)).toBe(7);
    expect(parseNumericAnswer(Number.NaN)).toBeNull();
    expect(parseNumericAnswer(undefined)).toBeNull();
  });

  it("reads both key shapes", () => {
    expect(readNumericToleranceKey(quizKey([10, "20"], "1.5"))).toEqual({ answers: [10, 20], tolerance: 1.5 });
    expect(readNumericToleranceKey(dataKey([5], 2))).toEqual({ answers: [5], tolerance: 2 });
    expect(readNumericToleranceKey(quizKey([], 2))).toBeNull();
  });

  it("matches any of several answers", () => {
    expect(isWithinTolerance(20.5, [10, 20], 1)).toBe(true);
    expect(isWithinTolerance(15, [10, 20], 1)).toBe(false);
  });
});
