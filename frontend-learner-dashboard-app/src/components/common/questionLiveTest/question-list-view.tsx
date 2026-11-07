import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAssessmentStore } from "@/stores/assessment-store";
import { QuestionDto } from "@/types/assessment";
import { QuestionHtmlContent } from "./question-html-content";
import {
  getQuestionStatus,
  getQuestionStatusLabel,
  QUESTION_STATUS_GRID_CLASS,
  QUESTION_STATUS_LIST_CLASS,
} from "./question-status-colors";

interface QuestionListViewProps {
  /** Called after a question is picked — closes the mobile palette sheet. */
  onSelect?: () => void;
}

export function QuestionListView({ onSelect }: QuestionListViewProps) {
  const { t } = useTranslation("questionTest");
  const {
    assessment,
    currentSection,
    currentQuestion,
    questionStates,
    setCurrentQuestion,
    setQuestionState,
    sectionTimers,
  } = useAssessmentStore();

  const currentSectionQuestions =
    assessment?.section_dtos?.[currentSection]?.question_preview_dto_list ?? [];
  const isTimeUp = sectionTimers[currentSection]?.timeLeft === 0;

  const handleQuestionClick = (question: QuestionDto) => {
    if (isTimeUp) return;
    setCurrentQuestion(question);
    setQuestionState(question.question_id, { isVisited: true });
    onSelect?.();
  };

  return (
    <div className="flex flex-col gap-2">
      {currentSectionQuestions.map((question, index) => {
        const state = questionStates[question.question_id];
        const status = getQuestionStatus(state);
        const isActive = currentQuestion?.question_id === question.question_id;

        return (
          <button
            key={question.question_id}
            type="button"
            disabled={isTimeUp}
            aria-label={t("questionList.itemAriaLabel", {
              number: index + 1,
              status: getQuestionStatusLabel(status, t),
            })}
            aria-current={isActive ? "true" : undefined}
            onClick={() => handleQuestionClick(question)}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border p-3 text-start transition-colors",
              QUESTION_STATUS_LIST_CLASS[status],
              !isTimeUp && "hover:border-neutral-300",
              isActive && "ring-2 ring-neutral-800",
              isTimeUp && "cursor-not-allowed opacity-50",
            )}
          >
            <span
              className={cn(
                "grid size-6 flex-none place-items-center rounded-md border text-2xs font-bold tabular-nums",
                QUESTION_STATUS_GRID_CLASS[status],
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 block text-caption text-neutral-700">
                <QuestionHtmlContent html={question.question.content} inline />
              </span>
              <span className="mt-1 block text-3xs font-semibold uppercase tracking-wide text-neutral-400">
                {question.question_type}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
