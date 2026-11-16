import { describe, expect, it } from "vitest";
import { reportVisibility } from "./report-visibility";

describe("reportVisibility", () => {
  it("shows everything when the backend sends no options", () => {
    expect(reportVisibility(null)).toEqual({
      questionWise: true,
      yourAnswer: true,
      correctAnswer: true,
      explanation: true,
    });
    expect(reportVisibility({ all_sections: {} }).correctAnswer).toBe(true);
  });

  it("hides what the assessment turned off", () => {
    const v = reportVisibility({
      report_options: { show_correct_answer: false, show_explanation: false },
    });
    expect(v).toEqual({
      questionWise: true,
      yourAnswer: true,
      correctAnswer: false,
      explanation: false,
    });
  });

  it("hides every per-question part when the question-wise section is off", () => {
    expect(
      reportVisibility({ report_options: { show_question_wise: false } })
    ).toEqual({
      questionWise: false,
      yourAnswer: false,
      correctAnswer: false,
      explanation: false,
    });
  });
});
