import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useConsole } from "../layouts/console-context";
import type { HeaderLinkId } from "../layouts/console-chrome";
import { CandidateBox } from "./CandidateBox";
import { ConsoleDialog } from "./ConsoleDialog";
import { Legend } from "./Legend";
import { PaletteGrid } from "./PaletteGrid";
import { SubmitButton } from "./SubmitButton";
import { usePaletteCounts } from "./use-console-data";

/**
 * Phone bottom sheet: candidate, legend with the open section's counts, the
 * section's chips and Submit, plus the header links. A chip tap opens that
 * question (same rule as the desktop palette) and closes the sheet.
 */
export function PhonePaletteSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("questionTest");
  const { theme, chrome, runAction } = useConsole();
  const sectionName = useAssessmentStore(
    (s) => s.assessment?.section_dtos?.[s.currentSection]?.name ?? "",
  );
  const counts = usePaletteCounts();
  const linkLabel = (id: HeaderLinkId) =>
    id === "question-paper"
      ? t("examThemes.tcs.links.questionPaper")
      : chrome.instructionsLabel === "viewInstructions"
        ? t("examThemes.tcs.links.viewInstructions")
        : t("examThemes.tcs.links.instructions");

  return (
    <ConsoleDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("examThemes.tcs.questionPalette")}
      sheet
    >
      <div className="tcs-sheet">
        <CandidateBox compact />
        <Legend order={theme.palette.legendOrder} counts={counts} />
        {theme.palette.sectionBar && <div className="tcs-section-bar">{sectionName}</div>}
        <div className="tcs-choose">{t("examThemes.tcs.chooseQuestion")}</div>
        <div className="tcs-right__grid">
          <PaletteGrid
            columns={theme.palette.columns}
            numbering={theme.palette.numbering}
            onJump={() => onOpenChange(false)}
          />
        </div>
        <div className="tcs-sheet__links">
          {chrome.headerLinks.map((id) => (
            <button
              key={id}
              type="button"
              className="tcs-btn tcs-btn--secondary"
              onClick={() => {
                onOpenChange(false);
                runAction(id);
              }}
            >
              {linkLabel(id)}
            </button>
          ))}
        </div>
        <SubmitButton beforeRun={() => onOpenChange(false)} />
      </div>
    </ConsoleDialog>
  );
}
