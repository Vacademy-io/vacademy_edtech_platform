import { describe, expect, it } from "vitest";
import {
  answerKindOf,
  correctAnswerHtml,
  instantVerdictOf,
  optionReview,
  submittedOptionsOf,
  type QuestionSlideResult,
} from "./question-slide-result";

const base: QuestionSlideResult = {
  submitted: true,
  show_answer: true,
  verdict: null,
  correct_option_ids: [],
  correct_answers: [],
};

describe("instantVerdictOf", () => {
  it("maps the server verdict", () => {
    expect(instantVerdictOf({ ...base, verdict: "CORRECT" })).toBe("correct");
    expect(instantVerdictOf({ ...base, verdict: "WRONG" })).toBe("incorrect");
  });

  it("shows a long answer's model answer to compare with", () => {
    expect(instantVerdictOf({ ...base, correct_answers: ["<p>Model</p>"] })).toBe("compare");
  });

  it("keeps the slide as before when the setting is off or nothing was submitted", () => {
    expect(instantVerdictOf({ ...base, show_answer: false, verdict: "CORRECT" })).toBeNull();
    expect(instantVerdictOf({ ...base, submitted: false, verdict: "CORRECT" })).toBeNull();
    expect(instantVerdictOf(null)).toBeNull();
  });

  it("shows nothing for a choice question with no key or a skipped answer", () => {
    expect(instantVerdictOf(base)).toBeNull();
    expect(instantVerdictOf({ ...base, verdict: "SKIPPED" })).toBeNull();
  });
});

describe("optionReview", () => {
  const result = { ...base, verdict: "WRONG", correct_option_ids: ["b"] };

  it("marks the correct option green and a wrong pick red", () => {
    expect(optionReview("b", ["a"], result)).toBe("correct");
    expect(optionReview("a", ["a"], result)).toBe("wrong");
    expect(optionReview("c", ["a"], result)).toBeNull();
  });
});

describe("correctAnswerHtml", () => {
  const options = [
    { id: "a", text: { content: "<p>6 J</p>" } },
    { id: "b", text: { content: "<p>9 J</p>" } },
  ];

  it("renders choice keys as their option text", () => {
    expect(correctAnswerHtml("MCQS", { ...base, correct_option_ids: ["b"] }, options)).toEqual(["<p>9 J</p>"]);
  });

  it("drops a keyed option that is not on the slide", () => {
    expect(correctAnswerHtml("MCQM", { ...base, correct_option_ids: ["zz", "a"] }, options)).toEqual([
      "<p>6 J</p>",
    ]);
  });

  it("uses the typed key for numeric and text questions", () => {
    expect(correctAnswerHtml("NUMERIC", { ...base, correct_answers: ["2.5", " "] }, [])).toEqual(["2.5"]);
    expect(answerKindOf("LONG_ANSWER")).toBe("model");
    expect(answerKindOf("ONE_WORD")).toBe("key");
  });
});

describe("submittedOptionsOf", () => {
  it("reads the learner's own latest answer", () => {
    expect(
      submittedOptionsOf({
        ...base,
        response_json: '{"questionName":"q","selectedOptions":[{"id":"b","name":"<p>B</p>"}]}',
      }),
    ).toEqual([{ id: "b", name: "<p>B</p>" }]);
  });

  it("is empty for a missing or unreadable answer", () => {
    expect(submittedOptionsOf(base)).toEqual([]);
    expect(submittedOptionsOf({ ...base, response_json: "{" })).toEqual([]);
    expect(submittedOptionsOf(null)).toEqual([]);
  });
});
