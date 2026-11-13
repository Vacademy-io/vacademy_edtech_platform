import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Preferences } from "@capacitor/preferences";
import { GET_TEXT_VIA_IDS } from "@/constants/urls";
import { fetchDataByIds } from "@/services/GetDataById";
import { safeParse } from "@/lib/storage";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";
import { useAssessmentStore } from "@/stores/assessment-store";
import { distribution_duration_types } from "@/types/assessment";
import { QuestionHtmlContent } from "../question-html-content";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { useLiveTestUi } from "../live-test-ui-context";
import { useConsole } from "../layouts/console-context";
import { effectiveAnswerCommit } from "../themes/layouts";
import { ConsoleDialog } from "./ConsoleDialog";
import { TcsGeneralInstructions } from "./TcsGeneralInstructions";

/** The assessment's own instructions (written by the institute), if any. */
function useAssessmentInstructions(enabled: boolean) {
  return useQuery({
    queryKey: ["exam-console-instructions"],
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<string> => {
      const { value } = await Preferences.get({ key: "InstructionID_and_AboutID" });
      const info = safeParse<{ instruction_id?: string } | null>(value, null);
      if (!info?.instruction_id) return "";
      const data = await fetchDataByIds(info.instruction_id, GET_TEXT_VIA_IDS);
      const content = Array.isArray(data) ? data[0]?.content : undefined;
      return typeof content === "string" ? content : "";
    },
  });
}

/**
 * "Instructions": the general instructions of instruction page 1 (how the
 * screen works and the saving rule of this test, in our own words), then the
 * institute's instructions for this test. The clock keeps running behind it.
 */
export function InstructionsModal() {
  const { t } = useTranslation("questionTest");
  const { overlay, setOverlay, theme, chrome } = useConsole();
  const { playMode } = useLiveTestEngine();
  const { settings } = useLiveTestUi();
  const durationMinutes = useAssessmentStore((s) => s.assessment?.duration ?? 0);
  const distribution = useAssessmentStore((s) => s.assessment?.distribution_duration);
  const open = overlay === "instructions";
  const { data: instructions } = useAssessmentInstructions(open);
  return (
    <ConsoleDialog
      open={open}
      onOpenChange={(next) => setOverlay(next ? "instructions" : null)}
      title={
        chrome.instructionsLabel === "viewInstructions"
          ? t("examThemes.tcs.links.viewInstructions")
          : t("examThemes.tcs.links.instructions")
      }
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
      <div className="tcs-instructions">
        <TcsGeneralInstructions
          theme={theme}
          answerCommit={effectiveAnswerCommit(theme)}
          submitLocked={
            theme.policy.earlySubmit === "disabled-until-end" && !isUntimedPlayMode(playMode)
          }
          durationMinutes={isUntimedPlayMode(playMode) ? 0 : durationMinutes}
          calculator={chrome.calculatorSlot && settings.calculator.enabled}
          partClock={
            distribution === distribution_duration_types.SECTION
              ? "section"
              : distribution === distribution_duration_types.QUESTION
                ? "question"
                : null
          }
        />
        {instructions && (
          <>
            <h3>{t("examThemes.tcs.instructions.testTitle")}</h3>
            <QuestionHtmlContent html={instructions} className="tcs-instructions__test" />
          </>
        )}
      </div>
    </ConsoleDialog>
  );
}
