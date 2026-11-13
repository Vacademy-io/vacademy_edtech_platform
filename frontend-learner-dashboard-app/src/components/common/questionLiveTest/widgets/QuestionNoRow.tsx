import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useConsole } from "../layouts/console-context";
import { usePaletteEntries } from "./use-console-data";

/**
 * "Question No. N" (TCS console) or "Question N:" (NTA mock), numbered like
 * the palette chips, and the round arrow that jumps to the bottom of a long
 * question, or back to the top once there.
 */
export function QuestionNoRow({
  atBottom,
  scrollable,
  onScrollJump,
  trailing,
}: {
  atBottom: boolean;
  scrollable: boolean;
  onScrollJump: () => void;
  /** Extra control at the right end (the phone's Question Palette button). */
  trailing?: ReactNode;
}) {
  const { t } = useTranslation("questionTest");
  const { chrome } = useConsole();
  const entries = usePaletteEntries();
  const currentId = useAssessmentStore((s) => s.currentQuestion?.question_id);
  const entry = entries.find((item) => item.question.question_id === currentId);
  if (!entry) return <div className="tcs-qno-row">{trailing}</div>;
  const labelKey =
    chrome.questionLabel === "question-colon"
      ? "examThemes.tcs.questionColon"
      : "examThemes.tcs.questionNo";
  return (
    <div className="tcs-qno-row">
      <span className="tcs-qno-row__label">{t(labelKey, { number: entry.number })}</span>
      {(scrollable || chrome.scrollJump === "always") && (
        <button
          type="button"
          className="tcs-scroll-jump"
          aria-label={atBottom ? t("examThemes.tcs.scrollTop") : t("examThemes.tcs.scrollBottom")}
          onClick={onScrollJump}
        >
          <span aria-hidden="true">
            {chrome.scrollJump === "always" ? (atBottom ? "↑" : "↓") : atBottom ? "▲" : "▼"}
          </span>
        </button>
      )}
      {trailing}
    </div>
  );
}
