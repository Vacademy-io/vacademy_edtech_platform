import { describe, expect, it } from "vitest";
import { cbeConfigHasSolution, parseCbeReviewConfig, parseCbeStudentResponse } from "./cbe-review";

const node = {
  questionId: "q1",
  responseData: {
    type: "CBE_RESPONSE",
    answer: { parts: { p1: { kind: "DOCUMENT", html: "<p>x</p>" } } },
    pasteAttemptCount: 2,
  },
};

describe("CBE report parsing", () => {
  it("reads the learner's parts from the attempt node (string or object)", () => {
    expect(parseCbeStudentResponse(JSON.stringify(node))).toEqual({
      parts: node.responseData.answer.parts,
      pasteAttemptCount: 2,
    });
    expect(parseCbeStudentResponse(node).parts).toEqual(node.responseData.answer.parts);
    expect(parseCbeStudentResponse("not json")).toEqual({ parts: {}, pasteAttemptCount: 0 });
  });

  it("detects whether the (post-release) config carries a model solution", () => {
    const redacted = { type: "CBE_RESPONSE", data: { version: 1, parts: [{ id: "p1", label: "(a)", kind: "DOCUMENT", marks: 4 }] } };
    const released = {
      ...redacted,
      data: { ...redacted.data, parts: [{ ...redacted.data.parts[0], solution: { html: "<p>model</p>" } }] },
    };
    expect(cbeConfigHasSolution(parseCbeReviewConfig(JSON.stringify(redacted)))).toBe(false);
    expect(cbeConfigHasSolution(parseCbeReviewConfig(JSON.stringify(released)))).toBe(true);
    expect(parseCbeReviewConfig("{}")).toBeNull();
  });
});
