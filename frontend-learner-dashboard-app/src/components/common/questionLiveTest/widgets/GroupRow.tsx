import { useTranslation } from "react-i18next";
import { Calculator, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { useLiveTestUi } from "../live-test-ui-context";
import { MAX_ZOOM_STEP, useConsole } from "../layouts/console-context";
import { SectionSummaryPopover } from "./SectionSummaryPopover";
import { statusCounts } from "./palette-logic";

/**
 * Grey row with the single group tab (the paper; this app has no question
 * groups), scroll arrows on presets whose console draws them, and the tool slot at the right end (calculator on
 * presets whose console has one, when the institute enables it; Zoom In /
 * Out where the console has them).
 */
export function GroupRow() {
  const { t } = useTranslation("questionTest");
  const { assessmentName } = useLiveTestEngine();
  const { chrome, zoomStep, setZoomStep } = useConsole();
  const { settings, activeTool, toggleTool } = useLiveTestUi();
  const assessment = useAssessmentStore((s) => s.assessment);
  const questionStates = useAssessmentStore((s) => s.questionStates);
  const all = assessment?.section_dtos?.flatMap((s) => s.question_preview_dto_list) ?? [];
  const showCalculator = chrome.calculatorSlot && settings.calculator.enabled;
  return (
    <div className="tcs-group-row">
      {chrome.groupArrows && (
        <button type="button" className="tcs-arrow" disabled aria-hidden="true" tabIndex={-1}>
          ◀
        </button>
      )}
      <span className="tcs-group-tab">
        <span className="tcs-group-tab__name">{assessmentName}</span>
        <SectionSummaryPopover
          title={assessmentName}
          counts={statusCounts(all, questionStates)}
        />
      </span>
      {chrome.groupArrows && (
        <button type="button" className="tcs-arrow" disabled aria-hidden="true" tabIndex={-1}>
          ▶
        </button>
      )}
      <span className="tcs-group-row__tools">
        {chrome.zoomSlot && (
          <>
            <button
              type="button"
              className="tcs-tool"
              aria-label={t("examThemes.tcs.zoomIn")}
              title={t("examThemes.tcs.zoomIn")}
              disabled={zoomStep >= MAX_ZOOM_STEP}
              onClick={() => setZoomStep(zoomStep + 1)}
            >
              <MagnifyingGlassPlus size={20} weight="bold" />
            </button>
            <button
              type="button"
              className="tcs-tool"
              aria-label={t("examThemes.tcs.zoomOut")}
              title={t("examThemes.tcs.zoomOut")}
              disabled={zoomStep <= 0}
              onClick={() => setZoomStep(zoomStep - 1)}
            >
              <MagnifyingGlassMinus size={20} weight="bold" />
            </button>
          </>
        )}
        {showCalculator && (
          <button
            type="button"
            className="tcs-tool"
            aria-pressed={activeTool === "calculator"}
            aria-label={t("examThemes.tcs.calculator")}
            title={t("examThemes.tcs.calculator")}
            onClick={() => toggleTool("calculator")}
          >
            <Calculator size={20} weight="fill" />
          </button>
        )}
      </span>
    </div>
  );
}
