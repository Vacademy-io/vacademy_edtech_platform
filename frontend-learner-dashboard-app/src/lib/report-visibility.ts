/**
 * What the assessment lets the student see per question in their report
 * (assessment_service V69 `report_options`, sent on /learner/report/detail as
 * `report_options`). The server already strips the hidden fields from the
 * payload; this tells the screens to leave the matching blocks out instead of
 * rendering an empty field as "Not attempted" or "No correct answer provided".
 * A missing object (older backend) means everything is shown.
 */
export interface ReportVisibility {
  questionWise: boolean;
  yourAnswer: boolean;
  correctAnswer: boolean;
  explanation: boolean;
}

export const reportVisibility = (detail: unknown): ReportVisibility => {
  const raw =
    detail && typeof detail === "object"
      ? (detail as { report_options?: unknown }).report_options
      : null;
  const o =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const questionWise = o.show_question_wise !== false;
  return {
    questionWise,
    yourAnswer: questionWise && o.show_your_answer !== false,
    correctAnswer: questionWise && o.show_correct_answer !== false,
    explanation: questionWise && o.show_explanation !== false,
  };
};
