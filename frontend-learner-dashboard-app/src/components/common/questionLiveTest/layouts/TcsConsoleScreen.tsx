import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Banner } from "../widgets/Banner";
import { BottomActionBar } from "../widgets/BottomActionBar";
import { GroupRow } from "../widgets/GroupRow";
import { QuestionPane } from "../widgets/QuestionPane";
import { QuestionTypeRow } from "../widgets/QuestionTypeRow";
import { RightPanel } from "../widgets/RightPanel";
import { SectionTabStrip } from "../widgets/SectionTabStrip";
import { SectionsRow } from "../widgets/SectionsRow";
import { SubHeader } from "../widgets/SubHeader";
import { ViewInBar } from "../widgets/ViewInBar";
import { useConsole } from "./console-context";

/**
 * Desktop TCS console (designed at 1366x768), top to bottom: banner, dark
 * sub-header, then the question column (group row, "Sections" + Time Left,
 * section tabs, question type and marks, the blue "View in" bar, the
 * question, the bottom action bar) beside the right panel (candidate,
 * legend, palette, Submit), and a footer strip.
 */
export function TcsConsoleScreen() {
  const { t } = useTranslation("questionTest");
  const { isPaletteCollapsed, setPaletteCollapsed } = useConsole();
  return (
    <>
      <Banner />
      <SubHeader />
      <div className="tcs-body">
        <div className="tcs-main">
          <GroupRow />
          <SectionsRow />
          <SectionTabStrip />
          <QuestionTypeRow />
          <ViewInBar />
          <QuestionPane />
          <BottomActionBar />
        </div>
        <div className={cn("tcs-side", isPaletteCollapsed && "tcs-side--collapsed")}>
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
          {!isPaletteCollapsed && <RightPanel />}
        </div>
      </div>
      <div className="tcs-footer" aria-hidden="true" />
    </>
  );
}
