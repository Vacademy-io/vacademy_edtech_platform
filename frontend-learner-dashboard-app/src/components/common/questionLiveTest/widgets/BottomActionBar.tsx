import { useConsole } from "../layouts/console-context";
import { consoleButtonsFor } from "../layouts/console-chrome";
import { ActionButton } from "./ActionButton";

/**
 * Bottom bar of the question pane: Mark for Review & Next and Clear
 * Response on the left, Save & Next on the right (per layout).
 */
export function BottomActionBar() {
  const { theme } = useConsole();
  const { left, right } = consoleButtonsFor(theme);
  return (
    <div className="tcs-bottom-bar">
      <span className="tcs-bottom-bar__group">
        {left.map((id) => (
          <ActionButton key={id} id={id} />
        ))}
      </span>
      <span className="tcs-bottom-bar__group">
        {right.map((id) => (
          <ActionButton key={id} id={id} />
        ))}
      </span>
    </div>
  );
}
