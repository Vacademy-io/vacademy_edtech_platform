import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAssessmentStore } from "@/stores/assessment-store";
import { isSubmitLocked } from "../actions";
import { useConsole } from "../layouts/console-context";
import { ActionButton } from "./ActionButton";
import { formatConsoleClock } from "./palette-logic";

/**
 * Submit, centred under the palette. On themes that hold Submit until the
 * end, a hint on hover says how long is left.
 */
export function SubmitButton({
  className,
  beforeRun,
}: {
  className?: string;
  /** Runs before the confirmation opens (the phone sheet closes itself). */
  beforeRun?: () => void;
}) {
  const { t } = useTranslation("questionTest");
  const { actionContext, theme } = useConsole();
  const timeLeft = useAssessmentStore((s) => s.entireTestTimer);
  const locked = isSubmitLocked(actionContext);
  const tipId = useId();
  const tooltip = locked
    ? t("examThemes.tcs.submitLocked", {
        time: formatConsoleClock(timeLeft, theme.timer.format),
      })
    : undefined;
  // A styled hint on the wrapper (a disabled button gets no hover events in
  // some browsers, and the native title tooltip is easy to miss). The button
  // points at the same text for screen readers.
  return (
    <div className={cn(className ?? "tcs-submit", locked && "tcs-submit--locked")}>
      <ActionButton id="submit" describedBy={locked ? tipId : undefined} beforeRun={beforeRun} />
      {locked && (
        <span id={tipId} role="tooltip" className="tcs-submit__tip">
          {tooltip}
        </span>
      )}
    </div>
  );
}
