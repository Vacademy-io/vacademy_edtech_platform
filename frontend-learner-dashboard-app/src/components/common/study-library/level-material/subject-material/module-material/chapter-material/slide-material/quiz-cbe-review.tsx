/**
 * A Spreadsheet & Written Response (CBE_RESPONSE) question in the quiz review: the
 * learner's answer, where its AI check stands (being checked, failed, not marked),
 * and once marked the result, line-by-line breakdown and, when the quiz review may
 * show answers, the model solution. Reads the attempt's recorded row; the server's
 * results (POST/GET .../quiz-slide/cbe/*) add the model solution and the latest state.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowCounterClockwise, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CbeStringsProvider } from "@/components/cbe/cbe-strings";
import { DocumentView } from "@/components/cbe/DocumentView";
import { SheetView } from "@/components/cbe/SheetView";
import { htmlToPlainText, parseCbeConfig, type CbeAnswer } from "@/components/cbe/types";
import { useLearnerCbeStrings } from "@/lib/cbe/learner-cbe-strings";
import { cn } from "@/lib/utils";
import type { QuizCbeQuestionResult } from "@/services/study-library/tracking-api/quiz-cbe-grading";
import { CriteriaTable, ModelSolution, ResultSummary } from "./cbe-question-slide";
import { formatCbeMarks, type CbeSlideAttempt } from "./cbe-slide-state";
import { parseCbeQuizAnswer, type QuizCbeRow, type QuizCbeState } from "./quiz-cbe";

type Props = {
  index: number;
  question: {
    text?: { content?: string } | string;
    text_data?: { content?: string };
    parent_rich_text?: { content?: string };
    auto_evaluation_json?: string;
    marks?: number | null;
  };
  /** The recorded row of the attempt on screen; null before the attempt is recorded. */
  row: QuizCbeRow | null;
  /** The answers-map value, for a submission whose row has not been read back yet. */
  fallbackAnswer?: unknown;
  /** The server's view of this question in the same attempt (adds the model solution). */
  result?: QuizCbeQuestionResult | null;
  /** A grade call for this attempt is running. */
  checking?: boolean;
  /** Asks for the AI check again (a failed one). */
  onRetry?: () => void;
  /** The question's maximum when nothing is recorded: its own marks or the quiz default. */
  defaultMaxMarks: number;
};

const hasVisibleHtml = (html: string | null | undefined): boolean =>
  !!html && (htmlToPlainText(html) !== "" || /<(img|table|svg)\b/i.test(html));

export function QuizCbeReviewCard({
  index,
  question,
  row,
  fallbackAnswer,
  result,
  checking = false,
  onRetry,
  defaultMaxMarks,
}: Props) {
  const { t } = useTranslation("libraryCommonB");
  const { t: tReview } = useTranslation("libraryCommonA");
  const cbeStrings = useLearnerCbeStrings();
  const config = useMemo(() => parseCbeConfig(question.auto_evaluation_json), [question.auto_evaluation_json]);

  const state: QuizCbeState | undefined = result?.state ?? row?.cbeState;
  const evaluation = result?.evaluation ?? row?.evaluation ?? null;
  const marks = result?.marks ?? row?.marks;
  const maxMarks = result?.max_marks ?? row?.maxMarks ?? defaultMaxMarks;
  const errorCode = result?.error_code ?? row?.error;
  const answer: CbeAnswer | null =
    result?.answer ?? row?.answer ?? parseCbeQuizAnswer(fallbackAnswer);
  const marked = state === "EVALUATED" && !!evaluation;
  const awaiting = checking || state === "PENDING" || state === "EVALUATING" || (!state && !!answer);
  const attempt: CbeSlideAttempt = {
    marks: marks ?? null,
    evaluation,
    solution: result?.solution ?? null,
  };

  const requirementHtml =
    typeof question.text === "string" ? question.text : question.text?.content ?? question.text_data?.content ?? "";
  const scenarioHtml = question.parent_rich_text?.content ?? "";

  const badgeClass = marked
    ? (marks ?? 0) >= maxMarks && maxMarks > 0
      ? "border-success-200 bg-success-50 text-success-700"
      : (marks ?? 0) > 0
        ? "border-warning-200 bg-warning-50 text-warning-700"
        : "border-danger-200 bg-danger-50 text-danger-700"
    : "border-neutral-200 bg-neutral-50 text-neutral-600";

  return (
    <CbeStringsProvider value={cbeStrings}>
      <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption font-medium text-neutral-500">
            {tReview("quizReview.questionNumber", { number: index + 1 })}
            <span className="ms-2 text-neutral-400">· {t("cbeSlide.typeLabel")}</span>
          </span>
          <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-caption font-semibold tabular-nums", badgeClass)}>
            {marked
              ? tReview("quizReview.questionMarks", {
                  earned: formatCbeMarks(Math.max(0, marks ?? 0)),
                  max: formatCbeMarks(maxMarks),
                })
              : t("quizCbe.marksPending", { max: formatCbeMarks(maxMarks) })}
          </span>
        </div>

        {hasVisibleHtml(scenarioHtml) && (
          <section className="max-h-reg-300 overflow-auto rounded-md border border-neutral-200 bg-white p-4">
            <h3 className="mb-1 text-3xs font-bold uppercase tracking-wide text-neutral-500">{t("cbeSlide.scenario")}</h3>
            <div className="rich-text-content text-body text-neutral-800" dangerouslySetInnerHTML={{ __html: scenarioHtml }} />
          </section>
        )}
        {hasVisibleHtml(requirementHtml) && (
          <div className="rich-text-content text-body text-neutral-900" dangerouslySetInnerHTML={{ __html: requirementHtml }} />
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-subtitle font-semibold text-neutral-900">{t("quizCbe.yourAnswer")}</h3>
          {answer && config ? (
            config.data.parts.map((part) => {
              const partAnswer = answer.parts?.[part.id];
              if (!partAnswer) return null;
              return (
                <div key={part.id} className="flex min-w-0 flex-col gap-1.5">
                  <p className="text-caption font-semibold text-neutral-700">
                    {[part.label, part.kind === "SPREADSHEET" ? t("cbeSlide.kindSpreadsheet") : t("cbeSlide.kindDocument")]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                  {partAnswer.kind === "SPREADSHEET" && "sheet" in partAnswer ? (
                    <SheetView sheet={partAnswer.sheet} />
                  ) : "html" in partAnswer ? (
                    <DocumentView html={partAnswer.html} className="rounded-md border border-neutral-200 bg-white p-3" />
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-body italic text-neutral-500">{t("quizCbe.skipped")}</p>
          )}
        </div>

        {awaiting && !marked && state !== "FAILED" && (
          <div className="flex items-center gap-3 rounded-xl border border-primary-100 bg-primary-50 p-4" role="status" aria-live="polite">
            <SpinnerGap size={20} className="flex-none animate-spin text-primary-500" />
            <div className="flex flex-col">
              <span className="text-body font-semibold text-neutral-900">
                {checking ? t("quizCbe.checking") : t("quizCbe.pending")}
              </span>
              {checking && <span className="text-caption text-neutral-600">{t("quizCbe.checkingHint")}</span>}
            </div>
          </div>
        )}

        {state === "FAILED" && !checking && (
          <Alert className="border-warning-200 bg-warning-50" role="alert">
            <WarningCircle size={16} />
            <AlertDescription className="flex flex-wrap items-center gap-3 text-body">
              <span>{errorCode === "NO_CREDITS" ? t("quizCbe.failedNoCredits") : t("quizCbe.failed")}</span>
              {onRetry && (
                <MyButton buttonType="secondary" scale="small" layoutVariant="default" onClick={onRetry}>
                  <ArrowCounterClockwise size={16} />
                  {t("quizCbe.retry")}
                </MyButton>
              )}
            </AlertDescription>
          </Alert>
        )}

        {state === "UNATTEMPTED" && <p className="text-body text-neutral-600">{t("quizCbe.unattempted")}</p>}
        {state === "NO_CHECKS_LEFT" && (
          <p className="text-body text-neutral-600">
            {t("quizCbe.noChecksLeft", { max: result?.max_checks ?? 3 })}
          </p>
        )}

        {marked && (
          <div className="flex flex-col gap-5 rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
            <ResultSummary attempt={attempt} t={t} />
            {evaluation?.feedback && (
              <p className="whitespace-pre-line text-body leading-relaxed text-neutral-700">{evaluation.feedback}</p>
            )}
            <CriteriaTable attempt={attempt} t={t} />
          </div>
        )}

        {config && attempt.solution && <ModelSolution attempt={attempt} config={config} t={t} />}
      </div>
    </CbeStringsProvider>
  );
}
