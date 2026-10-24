import { parseHtmlToString } from "@/lib/utils";
import type { TFunction } from "i18next";

interface QuestionOption {
  id: string;
  text: {
    content: string;
  };
}

export interface SectionQuestions {
  [key: string]: Array<{
    question_id: string;
    options: QuestionOption[];
    options_with_explanation: QuestionOption[];
  }>;
}

// Function to find option name by ID from questions data
const findOptionName = (
  optionId: string,
  questionsData: SectionQuestions | null,
  questionId: string
) => {
  if (!questionsData) return optionId;

  for (const sectionQuestions of Object.values(questionsData)) {
    const question = sectionQuestions.find((q) => q.question_id === questionId);
    if (question) {
      // Check in both options and options_with_explanation
      const option = [
        ...(question.options || []),
        ...(question.options_with_explanation || []),
      ].find((opt) => opt.id === optionId);

      if (option?.text?.content) {
        return parseHtmlToString(option.text.content);
      }
    }
  }
  return optionId;
};

interface ReviewOption {
  option_name: string;
}

interface Review {
  student_response_options: string | ReviewOption[];
  question_type: string;
  question_id: string;
  correct_options: string | ReviewOption[];
}

// Function to render student response based on question type
export const renderStudentResponse = (
  review: Review,
  questionsData: SectionQuestions | null = null,
  t: TFunction
) => {
  if (!review.student_response_options) return <p>{t("questionResponseRenderer.noResponse")}</p>;

  try {
    // Handle both string and object formats
    const responseData =
      typeof review.student_response_options === "string"
        ? JSON.parse(review.student_response_options)
        : review.student_response_options;

    // If it's an array, it's in the legacy format with direct option names
    if (Array.isArray(review.student_response_options)) {
      return review.student_response_options.map(
        (option: ReviewOption, idx: number) => (
          <p key={idx}>{parseHtmlToString(option.option_name)}</p>
        )
      );
    }

    switch (review.question_type) {
      case "ONE_WORD":
        return <p>{responseData.responseData?.answer || t("questionResponseRenderer.noResponse")}</p>;

      case "LONG_ANSWER":
        return <p>{responseData.responseData?.answer || t("questionResponseRenderer.noResponse")}</p>;

      case "NUMERIC":
        return (
          <p>
            {responseData.responseData?.validAnswer?.toString() ||
              t("questionResponseRenderer.noResponse")}
          </p>
        );

      case "MCQS":
      case "TRUE_FALSE":
        if (responseData.responseData?.optionIds?.length) {
          const optionId = responseData.responseData.optionIds[0]; // MCQS has single selection
          const optionName = findOptionName(
            optionId,
            questionsData,
            review.question_id
          );
          return <p>{optionName}</p>;
        }
        return <p>{t("questionResponseRenderer.noOptionSelected")}</p>;

      case "MCQM":
        if (responseData.responseData?.optionIds?.length) {
          return (
            <div>
              {responseData.responseData.optionIds.map((optionId: string) => {
                const optionName = findOptionName(
                  optionId,
                  questionsData,
                  review.question_id
                );
                return <p key={optionId}>{optionName}</p>;
              })}
            </div>
          );
        }
        return <p>{t("questionResponseRenderer.noOptionsSelected")}</p>;

      case "CODING": {
        const r = responseData.responseData || {};
        const tests = (r.testCaseResults || []) as Array<{
          id?: string;
          label?: string;
          passed?: boolean;
          visible?: boolean;
        }>;
        // Grading is based on the HIDDEN test cases (falling back to samples when
        // no hidden tests exist), so surface the graded breakdown explicitly rather
        // than a single ambiguous "passed/total".
        const hiddenTests = tests.filter((t) => t.visible === false);
        const sampleTests = tests.filter((t) => t.visible !== false);
        const gradedTests = hiddenTests.length > 0 ? hiddenTests : sampleTests;
        const gradedPassed = gradedTests.filter((t) => t.passed).length;
        const gradedTotal = gradedTests.length;
        const samplePassed = sampleTests.filter((t) => t.passed).length;
        const passed = gradedPassed;
        const total = gradedTotal;
        const verdictColor =
          r.verdict === "ACCEPTED"
            ? "text-green-700"
            : r.verdict === "PARTIAL"
              ? "text-yellow-700"
              : "text-red-700";

        // Pull allowed limits from the question's correct_options JSON
        // (data.perRunLimits.{cpuSeconds, memoryKb}). Render alongside the
        // measured totalTimeMs / peakMemoryKb from the submission.
        let allowedTimeMs: number | null = null;
        let allowedMemoryKb: number | null = null;
        try {
          const correct =
            typeof review.correct_options === "string"
              ? JSON.parse(review.correct_options)
              : review.correct_options;
          const limits = correct?.data?.perRunLimits;
          if (limits) {
            if (typeof limits.cpuSeconds === "number") {
              allowedTimeMs = limits.cpuSeconds * 1000;
            }
            if (typeof limits.memoryKb === "number") {
              allowedMemoryKb = limits.memoryKb;
            }
          }
        } catch {
          // correct_options not parseable — show measured values only.
        }

        const measuredTimeMs =
          typeof r.totalTimeMs === "number" ? r.totalTimeMs : null;
        const measuredMemoryKb =
          typeof r.peakMemoryKb === "number" ? r.peakMemoryKb : null;
        const showRuntimeRow =
          measuredTimeMs !== null ||
          measuredMemoryKb !== null ||
          allowedTimeMs !== null ||
          allowedMemoryKb !== null;
        return (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-medium ${verdictColor}`}>
                {r.verdict || "—"}
              </span>
              <span className="text-muted-foreground">
                {t("questionResponseRenderer.testsFraction", { passed, total })}
              </span>
              {typeof r.score === "number" && (
                <span className="text-muted-foreground">
                  {t("questionResponseRenderer.scorePts", { score: r.score.toFixed(2) })}
                </span>
              )}
              {r.language && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {r.language}
                </span>
              )}
              {(r.pasteAttemptCount ?? 0) > 0 && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  {t("questionResponseRenderer.pasteAttempts", { count: r.pasteAttemptCount })}
                </span>
              )}
            </div>
            {tests.length > 0 && (
              <div className="flex flex-wrap gap-3 text-xs">
                <span>
                  <b>{t("questionResponseRenderer.testCasesPassed")}</b>{" "}
                  <code className="rounded bg-muted px-1">
                    {gradedPassed}/{gradedTotal}
                  </code>{" "}
                  <span className="text-muted-foreground">
                    ({hiddenTests.length > 0 ? t("questionResponseRenderer.hiddenWord") : t("questionResponseRenderer.sampleWord")})
                  </span>
                </span>
                {hiddenTests.length > 0 && sampleTests.length > 0 && (
                  <span className="text-muted-foreground">
                    {t("questionResponseRenderer.sampleFraction", {
                      passed: samplePassed,
                      total: sampleTests.length,
                    })}
                  </span>
                )}
              </div>
            )}
            {showRuntimeRow && (
              <div className="flex flex-wrap gap-3 text-xs">
                <span>
                  <b>{t("questionResponseRenderer.timeTakenLabel")}</b>{" "}
                  <code className="rounded bg-muted px-1">
                    {measuredTimeMs !== null
                      ? t("questionResponseRenderer.msValue", { value: measuredTimeMs })
                      : "—"}
                  </code>
                  {allowedTimeMs !== null && (
                    <span className="text-muted-foreground">
                      {" "}
                      {t("questionResponseRenderer.msAllowed", { value: allowedTimeMs })}
                    </span>
                  )}
                </span>
                <span>
                  <b>{t("questionResponseRenderer.memoryLabel")}</b>{" "}
                  <code className="rounded bg-muted px-1">
                    {measuredMemoryKb !== null
                      ? t("questionResponseRenderer.kbValue", { value: measuredMemoryKb })
                      : "—"}
                  </code>
                  {allowedMemoryKb !== null && (
                    <span className="text-muted-foreground">
                      {" "}
                      {t("questionResponseRenderer.kbAllowed", { value: allowedMemoryKb })}
                    </span>
                  )}
                </span>
              </div>
            )}
            {r.sourceCode && (
              <details>
                <summary className="cursor-pointer text-xs">
                  {t("questionResponseRenderer.showSourceCode")}
                </summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-100 p-2 text-xs">
                  {r.sourceCode}
                </pre>
              </details>
            )}
            {tests.length > 0 && (
              <details open>
                <summary className="cursor-pointer text-xs">{t("questionResponseRenderer.testCasesHeading")}</summary>
                <div className="mt-1 space-y-1">
                  {tests.map((tc, i) => (
                    <div
                      key={tc.id || i}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span>{tc.passed ? "✓" : "✗"}</span>
                      <span>{tc.label || t("questionResponseRenderer.testNumber", { number: i + 1 })}</span>
                      {!tc.visible && (
                        <span className="text-muted-foreground">{t("questionResponseRenderer.hiddenParenthetical")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      }

      default:
        if (Array.isArray(review.student_response_options)) {
          return review.student_response_options.map(
            (option: ReviewOption, idx: number) => (
              <p key={idx}>{parseHtmlToString(option.option_name)}</p>
            )
          );
        }
        return (
          <p>{JSON.stringify(responseData.responseData) || t("questionResponseRenderer.noResponse")}</p>
        );
    }
  } catch (error) {
    console.error("Error parsing student response:", error);

    // Fallback for legacy format
    if (Array.isArray(review.student_response_options)) {
      return review.student_response_options.map(
        (option: ReviewOption, idx: number) => (
          <p key={idx}>{parseHtmlToString(option.option_name)}</p>
        )
      );
    }

    return <p>{t("questionResponseRenderer.errorDisplayingResponse")}</p>;
  }
};

// Function to render correct answer based on question type
export const renderCorrectAnswer = (
  review: Review,
  questionsData: SectionQuestions | null = null,
  t: TFunction
) => {
  if (!review.correct_options) return <p>{t("questionResponseRenderer.noCorrectAnswerProvided")}</p>;

  try {
    // Handle both string and array formats
    const correctData =
      typeof review.correct_options === "string"
        ? JSON.parse(review.correct_options)
        : review.correct_options;

    switch (review.question_type) {
      case "ONE_WORD":
        return <p>{correctData.data?.answer || t("questionResponseRenderer.noAnswerProvided")}</p>;

      case "LONG_ANSWER":
        if (correctData.data?.answer?.content) {
          return <p>{parseHtmlToString(correctData.data.answer.content)}</p>;
        }
        return <p>{t("questionResponseRenderer.noAnswerProvided")}</p>;

      case "NUMERIC":
        if (correctData.data?.validAnswers?.length) {
          return <p>{correctData.data.validAnswers.join(" or ")}</p>;
        }
        return <p>{t("questionResponseRenderer.noAnswerProvided")}</p>;

      case "MCQS":
      case "MCQM":
        if (correctData.data?.correctOptionIds?.length) {
          return (
            <div>
              {correctData.data.correctOptionIds.map((optionId: string) => {
                const optionName = findOptionName(
                  optionId,
                  questionsData,
                  review.question_id
                );
                return <p key={optionId}>{optionName}</p>;
              })}
            </div>
          );
        }
        return <p>{t("questionResponseRenderer.noCorrectOptionsProvided")}</p>;

      case "CODING": {
        const tcs = (correctData.data?.testCases || []) as Array<{
          visible?: boolean;
        }>;
        const total = tcs.length;
        const visible = tcs.filter((tc) => tc.visible).length;
        const hidden = total - visible;
        return (
          <p className="text-xs text-muted-foreground">
            {t("questionResponseRenderer.codingTestCaseSummary", { visible, hidden })}
          </p>
        );
      }

      default:
        if (Array.isArray(review.correct_options)) {
          return review.correct_options.map(
            (option: ReviewOption, idx: number) => (
              <p key={idx}>{parseHtmlToString(option.option_name)}</p>
            )
          );
        }
        return (
          <p>{JSON.stringify(correctData.data) || t("questionResponseRenderer.noAnswerProvided")}</p>
        );
    }
  } catch (error) {
    console.error("Error parsing correct answer:", error);

    // Fallback for legacy format
    if (Array.isArray(review.correct_options)) {
      return review.correct_options.map((option: ReviewOption, idx: number) => (
        <p key={idx}>{parseHtmlToString(option.option_name)}</p>
      ));
    }

    return <p>{t("questionResponseRenderer.errorDisplayingCorrectAnswer")}</p>;
  }
};
