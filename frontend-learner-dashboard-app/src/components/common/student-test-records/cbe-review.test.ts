import { describe, expect, it } from "vitest";
import { cbeConfigHasSolution, cbeReportScenarioHtml, parseCbeReviewConfig, parseCbeStudentResponse } from "./cbe-review";

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

describe("CBE report scenario", () => {
  const scenario = "<p>Alpha Co prepares its accounts to 31 March.</p>";
  const questions = {
    s1: [
      { question_id: "q1", parent_rich_text: { id: "p1", content: scenario } },
      { question_id: "q2", parent_rich_text: { id: "p2", content: "<p>A reading passage.</p>" } },
    ],
  };

  it("takes a CBE question's scenario from the questions the report loads", () => {
    expect(cbeReportScenarioHtml({ question_id: "q1", question_type: "CBE_RESPONSE" }, questions)).toBe(scenario);
  });

  it("keeps every other question type unchanged (no passage shown)", () => {
    expect(cbeReportScenarioHtml({ question_id: "q2", question_type: "MCQS" }, questions)).toBe("");
  });

  it("uses the row's own passage only when it really is the passage", () => {
    const row = { question_id: "q9", question_type: "CBE_RESPONSE", parent_id: "p9" };
    // Fixed server: parent_rich_text is the passage (its id = parent_id).
    expect(cbeReportScenarioHtml({ ...row, parent_rich_text: { id: "p9", content: scenario } }, null)).toBe(scenario);
    // Older server: parent_rich_text held the question text, under another id.
    expect(cbeReportScenarioHtml({ ...row, parent_rich_text: { id: "t9", content: "<p>Requirement</p>" } }, null)).toBe("");
  });

  it("returns nothing for a CBE question without a visible scenario", () => {
    const empty = { s1: [{ question_id: "q3", parent_rich_text: { id: "p3", content: "<p></p>" } }] };
    expect(cbeReportScenarioHtml({ question_id: "q3", question_type: "CBE_RESPONSE" }, empty)).toBe("");
    expect(cbeReportScenarioHtml({ question_id: "q4", question_type: "CBE_RESPONSE" }, null)).toBe("");
  });
});
