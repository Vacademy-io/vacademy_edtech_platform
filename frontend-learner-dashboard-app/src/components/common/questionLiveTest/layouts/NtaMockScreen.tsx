import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NtaActionPanel } from "../widgets/NtaActionPanel";
import { NtaBand } from "../widgets/NtaBand";
import { NtaHeader } from "../widgets/NtaHeader";
import { NtaRightPanel } from "../widgets/NtaRightPanel";
import { QuestionPane } from "../widgets/QuestionPane";
import { useConsole } from "./console-context";

/**
 * Desktop NTA mock layout (JEE Main web mock), top to bottom: the white
 * header (institute logo and name, candidate box with Remaining Time), the
 * orange band (exam short name and subject buttons), then the question
 * pane (about 60% wide: "Question N:", the question, two rows of buttons
 * and the Back / Next / Submit strip) beside the legend and palette, with
 * the collapse handle between them.
 *
 * It shares the TCS console's actions, chips, Exam Summary and saving
 * rules; only the arrangement and colours differ (nta-mock.css).
 */
export function NtaMockScreen() {
  const { t } = useTranslation("questionTest");
  const { isPaletteCollapsed, setPaletteCollapsed } = useConsole();
  return (
    <>
      <NtaHeader />
      <NtaBand />
      <div className="tcs-body nta-body">
        <div className="nta-main">
          <QuestionPane />
          <NtaActionPanel />
        </div>
        <div className={cn("tcs-side nta-side", isPaletteCollapsed && "tcs-side--collapsed")}>
          <button
            type="button"
            className="tcs-collapse"
            aria-expanded={!isPaletteCollapsed}
            aria-label={
              isPaletteCollapsed
                ? t("examThemes.tcs.showPalette")
                : t("examThemes.tcs.hidePalette")
            }
            onClick={() => setPaletteCollapsed(!isPaletteCollapsed)}
          >
            <span aria-hidden="true">{isPaletteCollapsed ? "‹" : "›"}</span>
          </button>
          {!isPaletteCollapsed && <NtaRightPanel />}
        </div>
      </div>
    </>
  );
}
