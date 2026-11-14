import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { jumpToPaletteTarget } from "../actions";
import { PaletteChip } from "./PaletteChip";
import { LEGEND_LABEL_KEY } from "./Legend";
import { chipLabel, chipStatusOf } from "./palette-logic";
import { usePaletteEntries } from "./use-console-data";

/**
 * The palette chips: the open section's questions, or every question of the
 * paper when the theme's palette covers the whole paper. A click opens that
 * question: an unsaved pick on the question being left is thrown away
 * (store rule) and the target becomes visited.
 */
export function PaletteGrid({
  columns,
  numbering,
  onJump,
}: {
  columns: number;
  numbering: "plain" | "two-digit";
  /** Called after a jump (the phone sheet closes itself). */
  onJump?: () => void;
}) {
  const { t } = useTranslation("questionTest");
  const entries = usePaletteEntries();
  const questionStates = useAssessmentStore((s) => s.questionStates);
  const currentId = useAssessmentStore((s) => s.currentQuestion?.question_id);
  const isSubmitted = useAssessmentStore((s) => s.isSubmitted);
  return (
    <div className="tcs-palette" data-columns={columns}>
      {entries.map((entry) => {
        const { question, number } = entry;
        const status = chipStatusOf(questionStates, question.question_id);
        return (
          <PaletteChip
            key={question.question_id}
            status={status}
            label={chipLabel(number - 1, numbering)}
            isCurrent={question.question_id === currentId}
            ariaLabel={t("examThemes.tcs.chipAriaLabel", {
              number,
              status: t(LEGEND_LABEL_KEY[status]),
            })}
            onClick={() => {
              if (isSubmitted) return;
              if (jumpToPaletteTarget(useAssessmentStore.getState, entry)) onJump?.();
            }}
          />
        );
      })}
    </div>
  );
}
