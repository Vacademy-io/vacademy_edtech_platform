"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { PaperPlaneTilt, X } from "@phosphor-icons/react";
import { useAssessmentStore } from "@/stores/assessment-store";
import { ViewToggle } from "./view-toggle";
import { QuestionListView } from "./question-list-view";
import { QuestionDto } from "@/types/assessment";
import { useLiveTestUi } from "./live-test-ui-context";
import {
  getQuestionStatus,
  getQuestionStatusLabel,
  isMarkedStatus,
  QUESTION_LEGEND_ORDER,
  QUESTION_STATUS_GRID_CLASS,
  type QuestionStatus,
} from "./question-status-colors";

interface QuestionNavigatorProps {
  onClose: () => void;
  /**
   * Collapses the desktop rail. Only the rail passes this — the phone sheet
   * dismisses via its drag handle and backdrop, so it renders no close button.
   */
  onCollapse?: () => void;
  evaluationType: string;
}

/**
 * Question palette — the same body serves the desktop right rail and the mobile
 * bottom sheet, so answered/marked counts can never drift between the two.
 */
export function QuestionNavigator({
  onClose,
  onCollapse,
  evaluationType,
}: QuestionNavigatorProps) {
  const { t } = useTranslation("questionTest");
  const { paletteView, setPaletteView, requestSubmit } = useLiveTestUi();
  const {
    assessment,
    currentSection,
    currentQuestion,
    questionStates,
    setCurrentQuestion,
    setQuestionState,
  } = useAssessmentStore();

  const currentSectionQuestions = React.useMemo(
    () => assessment?.section_dtos?.[currentSection]?.question_preview_dto_list ?? [],
    [assessment, currentSection],
  );

  const counts = React.useMemo(() => {
    const base: Record<QuestionStatus, number> = {
      answered: 0,
      "answered-marked": 0,
      marked: 0,
      "not-answered": 0,
      "not-visited": 0,
    };
    currentSectionQuestions.forEach((question) => {
      const status = getQuestionStatus(questionStates[question.question_id]);
      base[status] += 1;
    });
    return base;
  }, [currentSectionQuestions, questionStates]);

  if (!assessment) return null;

  const sectionName =
    assessment.section_dtos?.[currentSection]?.name ??
    t("questionNavigator.sectionFallback");
  const isManual = evaluationType === "MANUAL";

  const handleQuestionClick = (question: QuestionDto) => {
    setCurrentQuestion(question);
    setQuestionState(question.question_id, { isVisited: true });
    onClose();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50">
      <div className="flex-none border-b border-neutral-200 px-4 py-3">
        <div className="mb-3 flex items-start gap-2">
          {/* Section names are author-supplied and often already read
              "Section A — Biology", so the count sits on its own line rather
              than competing with the name for the truncation budget. */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold text-neutral-800">
              {sectionName}
            </p>
            <p className="text-2xs text-neutral-500">
              {t("questionNavigator.questionCount", {
                count: currentSectionQuestions.length,
              })}
            </p>
          </div>
          <ViewToggle view={paletteView} onViewChange={setPaletteView} />
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label={t("questionNavigator.hidePanel")}
              title={t("questionNavigator.hidePanel")}
              className="grid size-8 flex-none place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {!isManual && (
          <div
            className="grid grid-cols-2 gap-x-3 gap-y-2"
            aria-label={t("questionNavigator.legendAriaLabel")}
          >
            {QUESTION_LEGEND_ORDER.map((status) => (
              <div key={status} className="flex min-w-0 items-center gap-2">
                <span className="relative flex-none">
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-md border text-2xs font-bold",
                      QUESTION_STATUS_GRID_CLASS[status],
                    )}
                  >
                    {counts[status]}
                  </span>
                  {isMarkedStatus(status) && (
                    <span className="absolute -end-1 -top-1 size-2 rounded-full border border-white bg-success-500" />
                  )}
                </span>
                <span className="truncate text-2xs text-neutral-600">
                  {getQuestionStatusLabel(status, t)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {paletteView === "grid" ? (
          <div className="grid grid-cols-5 gap-2">
            {currentSectionQuestions.map((question, index) => {
              const state = questionStates[question.question_id];
              const status = getQuestionStatus(state);
              const isActive =
                currentQuestion?.question_id === question.question_id;
              return (
                <div key={question.question_id} className="relative">
                  <button
                    type="button"
                    aria-label={t("questionList.itemAriaLabel", {
                      number: index + 1,
                      status: getQuestionStatusLabel(status, t),
                    })}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      // Square, 40px-plus tap target — the grid is the primary
                      // way a learner moves around the paper on a phone.
                      "flex aspect-square w-full items-center justify-center rounded-lg border text-body font-semibold tabular-nums transition-colors",
                      QUESTION_STATUS_GRID_CLASS[status],
                      isActive &&
                        "ring-2 ring-neutral-800 ring-offset-1 ring-offset-neutral-50",
                    )}
                    onClick={() => handleQuestionClick(question)}
                  >
                    {index + 1}
                  </button>
                  {state?.isMarkedForReview && (
                    <span className="pointer-events-none absolute -end-1 -top-1 size-2.5 rounded-full border-2 border-white bg-success-500" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <QuestionListView onSelect={onClose} />
        )}
      </div>

      <div className="flex-none border-t border-neutral-200 bg-white p-4">
        <button
          type="button"
          onClick={requestSubmit}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 text-body font-semibold text-white transition-colors hover:bg-neutral-800"
        >
          <PaperPlaneTilt size={17} weight="fill" />
          {t("questionNavigator.submitPaper")}
        </button>
      </div>
    </div>
  );
}
