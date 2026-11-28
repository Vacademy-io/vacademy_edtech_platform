import { describe, expect, it } from "vitest";
import { isMultiSelectQuestion, partialCreditFraction } from "./quiz-scoring";

describe("partialCreditFraction", () => {
  const key = ["a", "c"];

  it("gives a share for picking only some of the correct options", () => {
    expect(partialCreditFraction(["a"], key)).toBe(0.5);
    expect(partialCreditFraction("a", key)).toBe(0.5); // collapsed single answer
  });

  it("gives nothing once any wrong option is picked", () => {
    expect(partialCreditFraction(["a", "b"], key)).toBe(0);
    expect(partialCreditFraction(["b"], key)).toBe(0);
  });

  it("gives nothing for unanswered or single-answer keys", () => {
    expect(partialCreditFraction([], key)).toBe(0);
    expect(partialCreditFraction(undefined, key)).toBe(0);
    expect(partialCreditFraction(["a"], ["a"])).toBe(0);
  });

  it("compares numbers and strings alike", () => {
    expect(partialCreditFraction([1], [1, 3])).toBe(0.5);
  });
});

describe("isMultiSelectQuestion", () => {
  it("is true only for the checkbox-rendered types", () => {
    expect(isMultiSelectQuestion("MCQM")).toBe(true);
    expect(isMultiSelectQuestion("CMCQM")).toBe(true);
    expect(isMultiSelectQuestion("MCQS")).toBe(false);
    expect(isMultiSelectQuestion("TRUE_FALSE")).toBe(false);
    expect(isMultiSelectQuestion(undefined)).toBe(false);
  });
});
