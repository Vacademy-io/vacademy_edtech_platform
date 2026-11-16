import { useTranslation } from "react-i18next";
import { CheckCircle, Info, XCircle } from "@phosphor-icons/react";
import type { InstantVerdict } from "./quiz-instant-feedback";

interface QuizInstantFeedbackPanelProps {
  verdict: InstantVerdict;
  /** The correct option texts or the expected typed answer, already rendered (math and all). */
  answerHtml: string[];
  /** "model" for a written answer the learner compares with; "key" otherwise. */
  answerKind: "key" | "model";
  explanationHtml: string | null;
}

const TONE: Record<InstantVerdict, { box: string; title: string }> = {
  correct: { box: "border-success-200 bg-success-50", title: "text-success-700" },
  incorrect: { box: "border-danger-200 bg-danger-50", title: "text-danger-700" },
  compare: { box: "border-primary-200 bg-primary-50", title: "text-primary-500" },
};

/**
 * What a study-mode quiz shows under a checked question: right or wrong (the wording of
 * the in-video question feedback), the correct answer and the author's explanation.
 */
export function QuizInstantFeedbackPanel({
  verdict,
  answerHtml,
  answerKind,
  explanationHtml,
}: QuizInstantFeedbackPanelProps) {
  const { t } = useTranslation("libraryCommonB");
  const tone = TONE[verdict];
  const showAnswer = answerHtml.length > 0 && verdict !== "correct";
  const answerLabel =
    answerKind === "model"
      ? t("quizViewer.instantFeedback.modelAnswer")
      : answerHtml.length > 1
        ? t("quizViewer.instantFeedback.correctAnswers")
        : t("quizViewer.instantFeedback.correctAnswer");
  const nothingToShow = verdict === "compare" && answerHtml.length === 0 && !explanationHtml;

  return (
    <div role="status" aria-live="polite" className={`mt-4 rounded-lg border p-4 ${tone.box}`}>
      <div className="flex items-center gap-2">
        {verdict === "correct" ? (
          <CheckCircle aria-hidden="true" weight="fill" className="size-5 shrink-0 text-success-600" />
        ) : verdict === "incorrect" ? (
          <XCircle aria-hidden="true" weight="fill" className="size-5 shrink-0 text-danger-600" />
        ) : (
          <Info aria-hidden="true" weight="fill" className="size-5 shrink-0 text-primary-500" />
        )}
        <p className={`font-medium ${tone.title}`}>
          {verdict === "correct"
            ? t("quizViewer.instantFeedback.correct")
            : verdict === "incorrect"
              ? t("quizViewer.instantFeedback.incorrect")
              : nothingToShow
                ? t("quizViewer.instantFeedback.noKey")
                : t("quizViewer.instantFeedback.compare")}
        </p>
      </div>

      {showAnswer && (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-semibold text-neutral-700">{answerLabel}</p>
          {answerHtml.map((html, index) => (
            <div
              key={index}
              className="rich-text-content min-w-0 break-words text-sm text-neutral-800"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ))}
        </div>
      )}

      {explanationHtml && (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-semibold text-neutral-700">{t("quizViewer.instantFeedback.explanation")}</p>
          <div
            className="rich-text-content min-w-0 break-words text-sm text-neutral-800"
            dangerouslySetInnerHTML={{ __html: explanationHtml }}
          />
        </div>
      )}
    </div>
  );
}
