import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import {
  isQuestionClockActive,
  isSectionClockActive,
  shouldShowEntireTimer,
} from "../engine/clock-logic";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { useConsole } from "../layouts/console-context";
import { formatConsoleClock } from "./palette-logic";

/**
 * "Time Left" with the whole-test clock in the preset's format: total
 * minutes (179:50) on the TCS console; "Remaining Time" with HH:MM:SS in a
 * pill on the NTA mock. Hidden for untimed papers.
 *
 * Papers timed per section or per question also get that clock beside it
 * ("Section Time Left" / "Question Time Left"): at 0 the engine moves the
 * learner on by itself, and an unsaved pick is lost, so the countdown has to
 * be on screen.
 */
export function ConsoleClock({
  withLabel = true,
}: {
  /** false: the pill only (the NTA header prints the label in its own column). */
  withLabel?: boolean;
} = {}) {
  const { t } = useTranslation("questionTest");
  const { playMode } = useLiveTestEngine();
  const { theme, chrome } = useConsole();
  const timeLeft = useAssessmentStore((s) => s.entireTestTimer);
  const part = usePartClock(playMode);
  const showMain = shouldShowEntireTimer(playMode, timeLeft);
  if (!showMain && !part) return null;
  const format = theme.timer.format;
  const partLabel = part
    ? t(
        part.kind === "section"
          ? "examThemes.tcs.sectionTimeLeft"
          : "examThemes.tcs.questionTimeLeft",
      )
    : "";
  const partClock = part ? formatConsoleClock(part.seconds, format) : "";

  if (chrome.clockLabel === "pill") {
    return (
      <span className="tcs-clocks">
        {showMain && (
          <span className="nta-clock" role="timer" aria-live="off">
            {withLabel && (
              <span className="nta-clock__label">{t("examThemes.tcs.remainingTime")}</span>
            )}
            <span className="nta-clock__pill">{formatConsoleClock(timeLeft, format)}</span>
          </span>
        )}
        {part && (
          <span className="nta-clock nta-clock--part" role="timer" aria-live="off">
            <span className="nta-clock__label">{partLabel}</span>
            <span className="nta-clock__pill">{partClock}</span>
          </span>
        )}
      </span>
    );
  }
  const join = (label: string, clock: string) =>
    chrome.clockLabel === "colon-space" ? `${label}: ${clock}` : `${label} :${clock}`;
  return (
    <span className="tcs-clocks">
      {showMain && (
        <span className="tcs-clock" role="timer" aria-live="off">
          {join(t("examThemes.tcs.timeLeft"), formatConsoleClock(timeLeft, format))}
        </span>
      )}
      {part && (
        <span className="tcs-clock tcs-clock--part" role="timer" aria-live="off">
          {join(partLabel, partClock)}
        </span>
      )}
    </span>
  );
}

/** The section clock (distribution SECTION) or the open question's clock (QUESTION). */
function usePartClock(
  playMode: string,
): { kind: "section" | "question"; seconds: number } | null {
  const distribution = useAssessmentStore((s) => s.assessment?.distribution_duration);
  const sectionMs = useAssessmentStore((s) => s.sectionTimers[s.currentSection]?.timeLeft);
  const questionId = useAssessmentStore((s) => s.currentQuestion?.question_id);
  const questionMs = useAssessmentStore((s) =>
    questionId ? s.questionTimers[questionId] : undefined,
  );
  if (isSectionClockActive(distribution, playMode) && typeof sectionMs === "number") {
    return { kind: "section", seconds: sectionMs / 1000 };
  }
  if (
    isQuestionClockActive(distribution, playMode, Boolean(questionId)) &&
    typeof questionMs === "number"
  ) {
    return { kind: "question", seconds: questionMs / 1000 };
  }
  return null;
}
