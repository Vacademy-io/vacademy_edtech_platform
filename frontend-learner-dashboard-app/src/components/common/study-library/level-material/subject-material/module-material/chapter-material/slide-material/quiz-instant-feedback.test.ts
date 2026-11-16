import { describe, expect, it } from "vitest";
import {
  checkAnswerRequestBody,
  feedbackFromLocalKey,
  feedbackFromServer,
  hasLocalAnswerKey,
  numericAnswerMatches,
  optionFeedbackState,
  textAnswerMatches,
} from "./quiz-instant-feedback";

const options = [{ id: "a" }, { id: "b" }, { id: "c" }];
const explanation = { content: "<p>Because a.</p>" };

describe("feedbackFromLocalKey — choice questions", () => {
  const mcqs = { question_type: "MCQS", auto_evaluation_json: '{"correctAnswers":["a"]}', options, explanation_text: explanation };

  it("marks the keyed option right and any other wrong, with the key and explanation", () => {
    expect(feedbackFromLocalKey(mcqs, "a")).toEqual({
      verdict: "correct",
      correctOptionIds: ["a"],
      correctAnswerText: null,
      explanationHtml: "<p>Because a.</p>",
    });
    expect(feedbackFromLocalKey(mcqs, "b")?.verdict).toBe("incorrect");
    expect(feedbackFromLocalKey(mcqs, "b")?.correctOptionIds).toEqual(["a"]);
  });

  it("needs the whole key on a multiple-correct question", () => {
    const mcqm = { question_type: "MCQM", auto_evaluation_json: '{"correctAnswers":["a","c"]}', options };
    expect(feedbackFromLocalKey(mcqm, ["c", "a"])?.verdict).toBe("correct");
    expect(feedbackFromLocalKey(mcqm, ["a"])?.verdict).toBe("incorrect");
    expect(feedbackFromLocalKey(mcqm, ["a", "b", "c"])?.verdict).toBe("incorrect");
    expect(feedbackFromLocalKey(mcqm, "a")?.verdict).toBe("incorrect");
  });

  it("reads a positional key as option ids (true/false)", () => {
    const tf = {
      question_type: "TRUE_FALSE",
      auto_evaluation_json: '{"correctAnswers":[1]}',
      options: [{ id: "t" }, { id: "f" }],
    };
    expect(feedbackFromLocalKey(tf, "f")).toMatchObject({ verdict: "correct", correctOptionIds: ["f"] });
    expect(feedbackFromLocalKey(tf, "t")?.verdict).toBe("incorrect");
  });

  it("leaves out an empty explanation", () => {
    const q = { ...mcqs, explanation_text: { content: "<p> </p>" } };
    expect(feedbackFromLocalKey(q, "a")?.explanationHtml).toBeNull();
  });
});

describe("feedbackFromLocalKey — typed questions", () => {
  it("compares numbers as numbers and never reads the value as an option position", () => {
    const numeric = {
      question_type: "NUMERIC",
      auto_evaluation_json: '{"correctAnswers":[0]}',
      options: [{ id: "input" }],
    };
    expect(feedbackFromLocalKey(numeric, 0)).toMatchObject({ verdict: "correct", correctAnswerText: "0" });
    expect(feedbackFromLocalKey(numeric, 1)?.verdict).toBe("incorrect");
    const decimal = { question_type: "NUMERIC", auto_evaluation_json: '{"correctAnswers":["2.5"]}' };
    expect(feedbackFromLocalKey(decimal, 2.5)?.verdict).toBe("correct");
    expect(feedbackFromLocalKey(decimal, "2.50")?.verdict).toBe("correct");
    expect(feedbackFromLocalKey(decimal, "abc")?.verdict).toBe("incorrect");
  });

  it("matches a one-word answer to the model answer ignoring case and spaces", () => {
    const oneWord = { question_type: "ONE_WORD", auto_evaluation_json: '{"data":{"answer":"Accrual basis"}}' };
    expect(feedbackFromLocalKey(oneWord, "  accrual   BASIS ")).toMatchObject({
      verdict: "correct",
      correctAnswerText: "Accrual basis",
    });
    expect(feedbackFromLocalKey(oneWord, "cash")?.verdict).toBe("incorrect");
  });

  it("shows a long answer's model answer without a verdict", () => {
    const long = { question_type: "LONG_ANSWER", auto_evaluation_json: '{"data":{"answer":{"content":"<p>Model</p>"}}}' };
    expect(feedbackFromLocalKey(long, "my essay")).toMatchObject({ verdict: "compare", correctAnswerText: "<p>Model</p>" });
  });

  it("returns null when the key is not in the app, so the server is asked", () => {
    expect(feedbackFromLocalKey({ question_type: "MCQS", options }, "a")).toBeNull();
    expect(feedbackFromLocalKey({ question_type: "MCQS", auto_evaluation_json: "not json", options }, "a")).toBeNull();
    expect(hasLocalAnswerKey({ question_type: "MCQS", options })).toBe(false);
    expect(hasLocalAnswerKey({ question_type: "MCQS", auto_evaluation_json: '{"correctAnswers":["a"]}' })).toBe(true);
  });
});

describe("feedbackFromServer", () => {
  it("uses the server verdict and option ids on a choice question", () => {
    expect(
      feedbackFromServer("MCQS", "b", { correct: false, correct_option_ids: ["a"], explanation: "<p>x</p>" })
    ).toEqual({ verdict: "incorrect", correctOptionIds: ["a"], correctAnswerText: null, explanationHtml: "<p>x</p>" });
  });

  it("shows a numeric key as the answer text", () => {
    expect(feedbackFromServer("NUMERIC", 3, { correct: true, correct_option_ids: ["3"] })).toMatchObject({
      verdict: "correct",
      correctOptionIds: [],
      correctAnswerText: "3",
    });
  });

  it("marks a one-word answer against the model answer when the server has no verdict", () => {
    const response = { correct: null, correct_option_ids: [], correct_answer_text: "Debit" };
    expect(feedbackFromServer("ONE_WORD", "debit", response).verdict).toBe("correct");
    expect(feedbackFromServer("ONE_WORD", "credit", response).verdict).toBe("incorrect");
    expect(feedbackFromServer("LONG_ANSWER", "text", { correct: null }).verdict).toBe("compare");
  });
});

describe("helpers", () => {
  it("numericAnswerMatches is the one numeric comparison", () => {
    expect(numericAnswerMatches("10", ["10.0"])).toBe(true);
    expect(numericAnswerMatches("", ["0"])).toBe(false);
    expect(numericAnswerMatches(["1"], ["1"])).toBe(false);
  });

  it("textAnswerMatches ignores case and repeated spaces", () => {
    expect(textAnswerMatches("Going  Concern", ["going concern"])).toBe(true);
    expect(textAnswerMatches(" ", ["x"])).toBe(false);
  });

  it("builds the check-answer body for picks and typed answers", () => {
    expect(checkAnswerRequestBody("s", "q", "MCQM", ["a", "b"])).toEqual({
      slide_id: "s",
      question_id: "q",
      selected_option_ids: ["a", "b"],
      text_answer: null,
    });
    expect(checkAnswerRequestBody("s", "q", "MCQS", "a")).toMatchObject({ selected_option_ids: ["a"], text_answer: null });
    expect(checkAnswerRequestBody("s", "q", "NUMERIC", 12.5)).toMatchObject({ selected_option_ids: [], text_answer: "12.5" });
    expect(checkAnswerRequestBody("s", "q", "ONE_WORD", "debit").text_answer).toBe("debit");
  });

  it("highlights the key and the learner's wrong pick only after checking", () => {
    const fb = { verdict: "incorrect" as const, correctOptionIds: ["a"], correctAnswerText: null, explanationHtml: null };
    expect(optionFeedbackState(fb, "a", false)).toBe("correct");
    expect(optionFeedbackState(fb, "b", true)).toBe("wrong");
    expect(optionFeedbackState(fb, "c", false)).toBe("none");
    expect(optionFeedbackState(undefined, "b", true)).toBe("none");
  });
});

describe("feedbackFromLocalKey with a numeric ± tolerance", () => {
  const withTolerance = {
    question_type: "NUMERIC",
    auto_evaluation_json: '{"correctAnswers":["1500"],"tolerance":1}',
  };

  it("accepts an answer inside the tolerance and shows the margin", () => {
    const fb = feedbackFromLocalKey(withTolerance, "1499.5");
    expect(fb?.verdict).toBe("correct");
    expect(fb?.correctAnswerText).toBe("1500 (± 1)");
  });

  it("rejects an answer outside the tolerance", () => {
    expect(feedbackFromLocalKey(withTolerance, "1502")?.verdict).toBe("incorrect");
  });

  it("keeps the exact rule when the question has no tolerance", () => {
    const exact = { question_type: "NUMERIC", auto_evaluation_json: '{"correctAnswers":["1500"]}' };
    expect(feedbackFromLocalKey(exact, "1499.5")?.verdict).toBe("incorrect");
    expect(feedbackFromLocalKey(exact, "1500")?.correctAnswerText).toBe("1500");
  });
});
