import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { ConsoleDialog } from "./ConsoleDialog";
import { examSummaryRows } from "./palette-logic";

/**
 * Submit confirmation of the console themes: an Exam Summary table with one
 * row per section, then Yes / No. Replaces the default submit dialog for
 * console layouts; the engine still owns the submit itself.
 */
export function ExamSummaryModal({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation("questionTest");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const assessment = useAssessmentStore((s) => s.assessment);
  const questionStates = useAssessmentStore((s) => s.questionStates);
  const rows = useMemo(
    () => examSummaryRows(assessment?.section_dtos ?? [], questionStates),
    [assessment, questionStates],
  );

  const confirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error("Submission error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ConsoleDialog
      open={open}
      onOpenChange={(next) => !isSubmitting && onOpenChange(next)}
      title={t("examThemes.tcs.summary.title")}
      wide
      centredTitle
      dismissible={!isSubmitting}
      footer={
        <>
          <p className="tcs-summary__prompt">{t("examThemes.tcs.summary.confirm")}</p>
          <span className="tcs-summary__buttons">
            <button
              type="button"
              className="tcs-btn tcs-btn--primary"
              disabled={isSubmitting}
              onClick={confirm}
            >
              {isSubmitting ? t("examThemes.tcs.summary.submitting") : t("examThemes.tcs.summary.yes")}
            </button>
            <button
              type="button"
              className="tcs-btn tcs-btn--secondary"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              {t("examThemes.tcs.summary.no")}
            </button>
          </span>
        </>
      }
    >
      <div className="tcs-summary__scroll">
        <table className="tcs-summary">
          <thead>
            <tr>
              <th scope="col">{t("examThemes.tcs.summary.section")}</th>
              <th scope="col">{t("examThemes.tcs.summary.questions")}</th>
              <th scope="col">{t("examThemes.tcs.legend.answered")}</th>
              <th scope="col">{t("examThemes.tcs.legend.notAnswered")}</th>
              <th scope="col">{t("examThemes.tcs.legend.marked")}</th>
              <th scope="col">{t("examThemes.tcs.summary.answeredMarked")}</th>
              <th scope="col">{t("examThemes.tcs.legend.notVisited")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sectionId}>
                <th scope="row">{row.name}</th>
                <td>{row.total}</td>
                <td>{row.counts.answered}</td>
                <td>{row.counts["not-answered"]}</td>
                <td>{row.counts.marked}</td>
                <td>{row.counts["answered-marked"]}</td>
                <td>{row.counts["not-visited"]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ConsoleDialog>
  );
}
