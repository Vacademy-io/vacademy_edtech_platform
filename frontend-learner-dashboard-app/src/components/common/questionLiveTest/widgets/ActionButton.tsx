import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { EXAM_ACTIONS, type ExamActionId } from "../actions";
import { useActionEnabled, useConsole } from "../layouts/console-context";

/** One console button, drawn from the action registry. */
export function ActionButton({
  id,
  className,
  title,
  describedBy,
  beforeRun,
}: {
  id: ExamActionId;
  className?: string;
  /** Tooltip (for example why Submit is not open yet). */
  title?: string;
  /** id of an element that describes the button (for example Submit's hint). */
  describedBy?: string;
  /** Runs first when the button is pressed (for example to close a sheet). */
  beforeRun?: () => void;
}) {
  const { t } = useTranslation("questionTest");
  const { runAction } = useConsole();
  const enabled = useActionEnabled(id);
  const action = EXAM_ACTIONS[id];
  return (
    <button
      type="button"
      data-action={id}
      disabled={!enabled}
      title={title}
      aria-describedby={describedBy}
      onClick={() => {
        beforeRun?.();
        runAction(id);
      }}
      className={cn("tcs-btn", `tcs-btn--${action.variant}`, className)}
    >
      {t(action.labelKey)}
    </button>
  );
}
