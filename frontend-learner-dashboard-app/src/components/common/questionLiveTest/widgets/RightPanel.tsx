import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { cn } from "@/lib/utils";
import { useConsole } from "../layouts/console-context";
import { CandidateBox } from "./CandidateBox";
import { Legend } from "./Legend";
import { PaletteGrid } from "./PaletteGrid";
import { SubmitButton } from "./SubmitButton";
import { usePaletteCounts } from "./use-console-data";

/**
 * Right panel: candidate box, legend with the open section's counts, the
 * section-name bar, "Choose a Question", the chips and Submit.
 */
export function RightPanel() {
  const { t } = useTranslation("questionTest");
  const { theme, chrome } = useConsole();
  const sectionName = useAssessmentStore(
    (s) => s.assessment?.section_dtos?.[s.currentSection]?.name ?? "",
  );
  const counts = usePaletteCounts();
  return (
    <aside className="tcs-right" aria-label={t("examThemes.tcs.questionPalette")}>
      <CandidateBox />
      <div className={cn("tcs-right__box", chrome.paletteBorder && "tcs-right__box--bordered")}>
        <Legend order={theme.palette.legendOrder} counts={counts} />
        {theme.palette.sectionBar && <div className="tcs-section-bar">{sectionName}</div>}
        <div className="tcs-choose">{t("examThemes.tcs.chooseQuestion")}</div>
        <div className="tcs-right__grid">
          <PaletteGrid
            columns={theme.palette.columns}
            numbering={theme.palette.numbering}
          />
        </div>
      </div>
      <SubmitButton />
    </aside>
  );
}
