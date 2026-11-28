import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProctoring } from "@/hooks";
import { WarningCircle, SpinnerGap } from "@phosphor-icons/react";
import { useAssessmentStore } from "@/stores/assessment-store";
import {
  getQuestionStatusLabel,
  QUESTION_LEGEND_ORDER,
  type QuestionStatus,
} from "@/components/common/questionLiveTest/question-status-colors";
import { paperSummary } from "@/components/common/questionLiveTest/widgets/palette-logic";

const STATUS_TONE: Record<QuestionStatus, string> = {
  answered: "text-success-700",
  "not-answered": "text-danger-600",
  "not-visited": "text-neutral-500",
  marked: "text-violet-700", // design-lint-ignore: status colour, as on the palette chips
  "answered-marked": "text-violet-700", // design-lint-ignore: status colour, as on the palette chips
};

interface SubmitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function SubmitModal({ open, onOpenChange, onConfirm }: SubmitModalProps) {
  const { t } = useTranslation("courseComponentsExtra");
  const { t: tStatus } = useTranslation("questionTest");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const assessment = useAssessmentStore((s) => s.assessment);
  const questionStates = useAssessmentStore((s) => s.questionStates);

  useProctoring({
    forceFullScreen: false,
    preventTabSwitch: false,
    preventContextMenu: false,
    preventUserSelection: false,
    preventCopy: false,
  });

  // The question palette's statuses and labels, so the two always agree: an
  // answered question marked for review is "Answered & marked" (evaluated,
  // never unanswered), and an answered question is never "Not visited".
  const summary = useMemo(
    () => paperSummary(assessment?.section_dtos ?? [], questionStates),
    [assessment, questionStates],
  );

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm();
      // Close the modal after successful submission
      onOpenChange(false);
    } catch (error) {
      console.error("Submission error:", error);
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <WarningCircle className="h-5 w-5 text-primary-500" />
            {t("submitModal.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {summary.total > 0 && summary.unanswered > 0
              ? t("submitModal.descriptionWithUnanswered", {
                  unanswered: summary.unanswered,
                  total: summary.total,
                })
              : t("submitModal.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {summary.total > 0 && (
          <div className="overflow-hidden rounded-xl border border-neutral-200">
            {[
              ...QUESTION_LEGEND_ORDER.map((status) => ({
                label: getQuestionStatusLabel(status, tStatus),
                value: summary.counts[status],
                tone: STATUS_TONE[status],
              })),
              { label: t("submitModal.totalQuestions"), value: summary.total, tone: "text-neutral-800" },
            ].map((row, index) => (
              <div
                key={row.label}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 text-body ${
                  index % 2 ? "bg-neutral-50" : "bg-white"
                } ${index ? "border-t border-neutral-100" : ""}`}
              >
                <span className={row.tone}>{row.label}</span>
                <span className="font-bold tabular-nums text-neutral-900">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction
            onClick={handleSubmit}
            className="w-full bg-primary-500 text-white relative"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center gap-2">
                <SpinnerGap className="h-4 w-4 animate-spin" />
                {t("submitModal.submitting")}
              </div>
            ) : (
              t("submitModal.submit")
            )}
          </AlertDialogAction>
          <AlertDialogCancel
            className="w-full mt-0"
            disabled={isSubmitting}
            onClick={() => !isSubmitting && onOpenChange(false)}
          >
            {t("common.cancel")}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}