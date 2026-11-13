import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { QUESTION_TYPES } from "@/types/assessment";
import { useLiveTestUi } from "../live-test-ui-context";
import { useConsole } from "../layouts/console-context";
import { questionTypeLabel } from "../question-type-label";
import { formatMarks, parseMarking } from "./palette-logic";

/**
 * "Question Type: MCQ" on the left; "Marks for correct answer: 4 |
 * Negative Marks: 1" on the right, from the question's own marking.
 */
export function QuestionTypeRow() {
  const { t } = useTranslation("questionTest");
  const { chrome } = useConsole();
  const { settings } = useLiveTestUi();
  const question = useAssessmentStore((s) => s.currentQuestion);
  if (!question) return <div className="tcs-qtype-row" />;

  const type = question.question_type;
  const typeLabel =
    type === QUESTION_TYPES.MCQS || type === QUESTION_TYPES.TRUE_FALSE
      ? t("examThemes.tcs.questionTypes.mcq")
      : type === QUESTION_TYPES.MCQM
        ? t("examThemes.tcs.questionTypes.msq")
        : type === QUESTION_TYPES.NUMERIC
          ? chrome.numericLabel === "nat"
            ? t("examThemes.tcs.questionTypes.nat")
            : t("examThemes.tcs.questionTypes.numerical")
          : questionTypeLabel(type, t);
  const { correct, negative } = parseMarking(question.marking_json);

  return (
    <div className="tcs-qtype-row">
      <span className="tcs-qtype-row__type">
        {t("examThemes.tcs.questionType")}: {typeLabel}
      </span>
      {settings.showMarkingScheme && (
        <span className="tcs-qtype-row__marks">
          {t("examThemes.tcs.marksCorrect")}:{" "}
          <span className="tcs-marks tcs-marks--positive">{formatMarks(correct)}</span>
          <span className="tcs-qtype-row__sep" aria-hidden="true">
            |
          </span>
          {t("examThemes.tcs.marksNegative")}:{" "}
          <span className="tcs-marks tcs-marks--negative">{formatMarks(negative)}</span>
        </span>
      )}
    </div>
  );
}
