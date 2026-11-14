import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { QUESTION_TYPES } from "@/types/assessment";
import { QuestionHtmlContent } from "../question-html-content";
import { useConsole } from "../layouts/console-context";
import { ConsoleDialog } from "./ConsoleDialog";

/**
 * "Question Paper": every question of the open section, read only. Only the
 * open section is listed, so a paper whose sections open in order (or have
 * their own clocks) does not show a section the learner may not enter yet.
 * The clock keeps running behind it. Nothing here changes an answer.
 */
export function QuestionPaperModal() {
  const { t } = useTranslation("questionTest");
  const { overlay, setOverlay } = useConsole();
  const section = useAssessmentStore(
    (s) => s.assessment?.section_dtos?.[s.currentSection],
  );
  const open = overlay === "question-paper";
  return (
    <ConsoleDialog
      open={open}
      onOpenChange={(next) => setOverlay(next ? "question-paper" : null)}
      title={t("examThemes.tcs.links.questionPaper")}
      wide
      footer={
        <button
          type="button"
          className="tcs-btn tcs-btn--secondary"
          onClick={() => setOverlay(null)}
        >
          {t("examThemes.tcs.close")}
        </button>
      }
    >
      {open && (
        <div className="tcs-paper">
          {section && (
            <section className="tcs-paper__section">
              <h3 className="tcs-paper__section-name">{section.name}</h3>
              <ol className="tcs-paper__list">
                {section.question_preview_dto_list.map((question, index) => (
                  <li key={question.question_id} className="tcs-paper__item">
                    <span className="tcs-paper__number">
                      {t("examThemes.tcs.questionNo", { number: index + 1 })}
                    </span>
                    {question.parent_rich_text?.content && (
                      <QuestionHtmlContent
                        html={question.parent_rich_text.content}
                        className="tcs-paper__passage"
                      />
                    )}
                    <QuestionHtmlContent html={question.question.content} />
                    {(question.question_type === QUESTION_TYPES.MCQS ||
                      question.question_type === QUESTION_TYPES.MCQM ||
                      question.question_type === QUESTION_TYPES.TRUE_FALSE) && (
                      <ol className="tcs-paper__options">
                        {question.options?.map((option) => (
                          <li key={option.id}>
                            <QuestionHtmlContent html={option.text.content} inline />
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </ConsoleDialog>
  );
}
