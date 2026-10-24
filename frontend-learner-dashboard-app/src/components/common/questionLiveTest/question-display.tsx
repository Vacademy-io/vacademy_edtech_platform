import { Check, WarningCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEffect, useState } from "react";
import {
  distribution_duration_types,
  QUESTION_TYPES,
} from "@/types/assessment";
import { cn, parseHtmlToString } from "@/lib/utils";
import { Preferences } from "@capacitor/preferences";
import { NumericInputWithKeypad } from "./otherQuestionTypes/numeric";
import { ExpandableParagraph } from "./otherQuestionTypes/paragraph";
import { OneWordInput } from "./otherQuestionTypes/OneWordInput";
import { LongAnswerInput } from "./otherQuestionTypes/LongAnswerInput";
import { CodingQuestionDisplay } from "./otherQuestionTypes/CodingQuestionDisplay";
import { QuestionHtmlContent } from "./question-html-content";
import { QuestionPassage } from "./question-passage";
import { useLiveTestUi } from "./live-test-ui-context";

const OPTION_LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Small pill used for question type and marking scheme. */
function MetaChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "positive" | "negative";
}) {
  const tones = {
    neutral: "bg-neutral-100 text-neutral-600",
    positive: "bg-success-50 text-success-700",
    negative: "bg-danger-50 text-danger-600",
  } as const;
  return (
    <span
      className={cn(
        "flex-none rounded-md px-2 py-1 text-3xs font-semibold uppercase tracking-wide",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function QuestionDisplay() {
  const { t } = useTranslation("questionTest");
  const { settings } = useLiveTestUi();
  const {
    currentQuestion,
    currentSection,
    answers,
    setAnswer,
    sectionTimers,
    questionTimers,
    assessment,
    updateQuestionTimer,
    moveToNextQuestion,
    initializeQuestionTime,
    incrementQuestionTime,
  } = useAssessmentStore();

  const [playMode, setPlayMode] = useState<string | null>(null);
  const [isManualTest, setIsManualTest] = useState(false);

  useEffect(() => {
    const fetchPlayMode = async () => {
      const storedMode = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      if (storedMode.value) {
        const parsedData = JSON.parse(storedMode.value);
        setPlayMode(parsedData.play_mode);
        setIsManualTest(parsedData.evaluation_type === "MANUAL");
      }
    };

    fetchPlayMode();
  }, []);

  const isTimeUp = sectionTimers[currentSection]?.timeLeft === 0;
  const isPracticeMode = playMode === "PRACTICE" || playMode === "SURVEY";

  useEffect(() => {
    if (!currentQuestion?.question_id) return;
    initializeQuestionTime(currentQuestion.question_id);

    const interval = setInterval(() => {
      incrementQuestionTime(currentQuestion.question_id);
    }, 1000);

    return () => clearInterval(interval);
  }, [currentQuestion, initializeQuestionTime, incrementQuestionTime]);

  useEffect(() => {
    if (
      isPracticeMode ||
      !currentQuestion ||
      assessment?.distribution_duration !== distribution_duration_types.QUESTION
    )
      return;

    const timer = setInterval(() => {
      const timeLeft = questionTimers[currentQuestion.question_id] || 0;
      if (timeLeft > 0) {
        updateQuestionTimer(currentQuestion.question_id, timeLeft - 1000);
      } else {
        moveToNextQuestion();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [
    currentQuestion,
    assessment?.distribution_duration,
    questionTimers,
    isPracticeMode,
  ]);

  if (!currentQuestion) {
    return (
      <p className="py-12 text-center text-body text-neutral-500">
        {t("questionDisplay.selectPrompt")}
      </p>
    );
  }

  if (isTimeUp && !isPracticeMode) {
    return (
      <Alert variant="destructive">
        <WarningCircle className="size-4" />
        <AlertDescription>
          {t("questionDisplay.sectionTimeUp")}
        </AlertDescription>
      </Alert>
    );
  }

  const currentAnswer = answers[currentQuestion.question_id] || [];

  const sectionQuestions =
    assessment?.section_dtos?.[currentSection]?.question_preview_dto_list ?? [];
  const indexInSection = sectionQuestions.findIndex(
    (question) => question.question_id === currentQuestion.question_id,
  );

  const handleAnswerChange = (optionId: string) => {
    const newAnswer =
      currentQuestion.question_type === QUESTION_TYPES.MCQM
        ? currentAnswer.includes(optionId)
          ? currentAnswer.filter((id) => id !== optionId)
          : [...currentAnswer, optionId]
        : [optionId];

    setAnswer(currentQuestion.question_id, newAnswer);
  };

  const parseMarkingScheme = (marking_json: string) => {
    try {
      return JSON.parse(marking_json)?.data ?? {};
    } catch (error) {
      console.error("Error parsing marking_json:", error);
      return {};
    }
  };

  const marking = parseMarkingScheme(currentQuestion.marking_json);
  const totalMark = Number(marking?.totalMark ?? 0);
  const negativeMark = Number(marking?.negativeMark ?? 0);

  const hasEmbeddedOptionPrefix = (optionHtml: string, optionIndex: number) => {
    const plainText = parseHtmlToString(optionHtml).trim();
    if (!plainText) return false;

    const expectedAlpha = OPTION_LETTERS[optionIndex % OPTION_LETTERS.length];
    const alphaPattern = new RegExp(
      `^\\(?${expectedAlpha}\\)?[).:-]\\s*`,
      "i",
    );
    const genericAlphaPattern = /^\(?[a-z]\)?[).:-]\s*/i;
    const numericPattern = /^\(?\d+\)?[).:-]\s*/;

    return (
      alphaPattern.test(plainText) ||
      genericAlphaPattern.test(plainText) ||
      numericPattern.test(plainText)
    );
  };

  const isMultiSelect = currentQuestion.question_type === QUESTION_TYPES.MCQM;

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Question header — number on the left, marking scheme on the right, so
          both survive a narrow phone without the stem shifting around. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 md:mb-5">
        <span className="text-title font-bold text-neutral-900">
          {t("common.questionNumber", {
            number:
              indexInSection >= 0
                ? indexInSection + 1
                : currentQuestion.serial_number,
          })}
        </span>
        <span className="text-caption text-neutral-400">
          {t("questionDisplay.ofTotal", { total: sectionQuestions.length })}
        </span>
        {!isPracticeMode &&
          assessment?.distribution_duration ===
            distribution_duration_types.QUESTION && (
            <span className="font-mono text-caption font-semibold tabular-nums text-primary-500">
              {new Date(questionTimers[currentQuestion.question_id] || 0)
                .toISOString()
                .substr(14, 5)}
            </span>
          )}
        <span className="flex-1" />
        <MetaChip>{currentQuestion.question_type}</MetaChip>
        {settings.showMarkingScheme && totalMark > 0 && (
          <MetaChip tone="positive">+{totalMark}</MetaChip>
        )}
        {settings.showMarkingScheme && negativeMark > 0 && (
          <MetaChip tone="negative">−{negativeMark}</MetaChip>
        )}
      </div>

      <ExpandableParagraph />

      {/* Comprehension passage for this question (backend: parent_rich_text).
          ExpandableParagraph above is a different thing — the assessment-wide
          "about" text fetched once from about_id — so it never showed passages. */}
      <QuestionPassage html={currentQuestion.parent_rich_text?.content} />

      {/* Tailwind's reset strips <p> margins — a multi-paragraph stem would
          otherwise render as one block with no breaks. */}
      <QuestionHtmlContent
        html={currentQuestion.question.content}
        className="mb-5 text-subtitle leading-relaxed text-neutral-900 md:mb-6 md:text-title [&_img]:h-auto [&_img]:max-w-full [&_p:last-child]:mb-0 [&_p]:mb-3"
      />

      {(() => {
        switch (currentQuestion.question_type) {
          case QUESTION_TYPES.NUMERIC:
            return !isManualTest && <NumericInputWithKeypad />;
          case QUESTION_TYPES.ONE_WORD:
            return !isManualTest && <OneWordInput />;
          case QUESTION_TYPES.LONG_ANSWER:
            return !isManualTest && <LongAnswerInput />;
          case QUESTION_TYPES.CODING: {
            let codingConfig: import(
              "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/coding-question/types"
            ).CodingQuestionConfig | null = null;
            try {
              const parsed = JSON.parse(currentQuestion.evaluation_json || "{}");
              codingConfig = parsed?.data ?? null;
            } catch {
              codingConfig = null;
            }
            if (!codingConfig) {
              return (
                <p className="text-body text-neutral-500">
                  {t("questionDisplay.codingMissingConfig")}
                </p>
              );
            }
            return (
              <CodingQuestionDisplay
                key={currentQuestion.question_id}
                questionId={currentQuestion.question_id}
                attemptId={assessment?.attempt_id}
                config={codingConfig}
              />
            );
          }
          case QUESTION_TYPES.MCQM:
          case QUESTION_TYPES.MCQS:
          case QUESTION_TYPES.TRUE_FALSE:
            return (
              <div
                className="flex flex-col gap-stack"
                role={isMultiSelect ? "group" : "radiogroup"}
                aria-label={t("questionDisplay.answerOptionsAriaLabel")}
              >
                {currentQuestion?.options?.map((option, index) => {
                  const isSelected = currentAnswer.includes(option.id);
                  const letter =
                    OPTION_LETTERS[index % OPTION_LETTERS.length];
                  const showLetterPrefix = !hasEmbeddedOptionPrefix(
                    option.text.content,
                    index,
                  );

                  const body = (
                    <>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-7 flex-none place-items-center border text-caption font-bold transition-colors",
                          isMultiSelect ? "rounded-md" : "rounded-full",
                          isSelected
                            ? "border-primary-500 bg-primary-500 text-white"
                            : "border-neutral-300 bg-white text-neutral-500",
                        )}
                      >
                        {isSelected ? (
                          <Check size={15} weight="bold" />
                        ) : showLetterPrefix ? (
                          letter
                        ) : (
                          ""
                        )}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 pt-0.5 text-body leading-relaxed md:text-subtitle",
                          isSelected
                            ? "font-medium text-neutral-900"
                            : "text-neutral-700",
                        )}
                      >
                        <QuestionHtmlContent
                          html={option.text.content}
                          inline
                        />
                      </span>
                    </>
                  );

                  // MANUAL assessments are answered by uploading a paper, so
                  // options are reference material — readable, not tappable.
                  if (isManualTest) {
                    return (
                      <div
                        key={option.id}
                        className="flex w-full items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4"
                      >
                        {body}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={option.id}
                      type="button"
                      role={isMultiSelect ? "checkbox" : "radio"}
                      aria-checked={isSelected}
                      onClick={() => handleAnswerChange(option.id)}
                      className={cn(
                        // p-4 on a 44px-plus row: the whole option is the target,
                        // not just the letter badge.
                        "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-start transition-colors",
                        isSelected
                          ? "border-primary-500 bg-primary-50"
                          : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50",
                      )}
                    >
                      {body}
                    </button>
                  );
                })}
              </div>
            );
          default:
            return (
              <p className="text-body text-neutral-500">
                {t("questionDisplay.unsupportedType")}
              </p>
            );
        }
      })()}
    </div>
  );
}
