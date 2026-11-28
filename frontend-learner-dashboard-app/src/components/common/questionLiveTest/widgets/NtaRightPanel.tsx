import { useTranslation } from "react-i18next";
import { useConsole } from "../layouts/console-context";
import { Legend } from "./Legend";
import { PaletteGrid } from "./PaletteGrid";
import { usePaletteCounts } from "./use-console-data";

/**
 * Right pane of the NTA mock layout: the legend first (Not Visited, Not
 * Answered, Answered, Marked for Review, then Answered & Marked on its own
 * line), then the chips, 8 to a row and numbered 01, 02, ... There is no
 * candidate box (it is in the header), no section-name bar and no Submit
 * (it is in the strip under the question).
 */
export function NtaRightPanel() {
  const { t } = useTranslation("questionTest");
  const { theme } = useConsole();
  const counts = usePaletteCounts();
  return (
    <aside className="nta-right" aria-label={t("examThemes.tcs.questionPalette")}>
      <Legend order={theme.palette.legendOrder} counts={counts} />
      <div className="nta-right__grid">
        <PaletteGrid columns={theme.palette.columns} numbering={theme.palette.numbering} />
      </div>
    </aside>
  );
}
