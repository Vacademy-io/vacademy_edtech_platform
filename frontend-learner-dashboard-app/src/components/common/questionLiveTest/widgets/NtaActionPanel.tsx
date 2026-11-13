import { NTA_MOCK_BUTTONS } from "../layouts/console-chrome";
import { ActionButton } from "./ActionButton";
import { SubmitButton } from "./SubmitButton";

/**
 * Buttons under the question on the NTA mock layout: two rows of save and
 * mark actions, then a separate strip with << BACK and NEXT >> on the left
 * and SUBMIT on the right. Each button is an action of the registry, so the
 * saving rules are the same as on the TCS console.
 */
export function NtaActionPanel() {
  const { rows, strip } = NTA_MOCK_BUTTONS;
  return (
    <div className="nta-actions">
      <div className="nta-actions__rows">
        {rows.map((row, index) => (
          <div key={index} className="nta-actions__row">
            {row.map((id) => (
              <ActionButton key={id} id={id} />
            ))}
          </div>
        ))}
      </div>
      <div className="nta-strip">
        <span className="nta-strip__group">
          {strip.left.map((id) => (
            <ActionButton key={id} id={id} />
          ))}
        </span>
        <span className="nta-strip__group">
          {strip.right.map((id) =>
            id === "submit" ? (
              <SubmitButton key={id} className="nta-strip__submit" />
            ) : (
              <ActionButton key={id} id={id} />
            ),
          )}
        </span>
      </div>
    </div>
  );
}
