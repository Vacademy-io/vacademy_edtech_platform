import { useTranslation } from "react-i18next";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { useConsole } from "../layouts/console-context";
import type { HeaderLinkId } from "../layouts/console-chrome";

/** Dark title bar: test title (yellow) and the paper / instructions links. */
export function SubHeader() {
  const { t } = useTranslation("questionTest");
  const { assessmentName } = useLiveTestEngine();
  const { chrome, runAction } = useConsole();
  const label = (id: HeaderLinkId) =>
    id === "question-paper"
      ? t("examThemes.tcs.links.questionPaper")
      : chrome.instructionsLabel === "viewInstructions"
        ? t("examThemes.tcs.links.viewInstructions")
        : t("examThemes.tcs.links.instructions");
  return (
    <div className="tcs-subheader">
      <span className="tcs-subheader__title">{assessmentName}</span>
      <span className="tcs-subheader__links">
        {chrome.headerLinks.map((id) => (
          <button
            key={id}
            type="button"
            className="tcs-subheader__link"
            onClick={() => runAction(id)}
          >
            <span
              className={
                id === "question-paper"
                  ? "tcs-round-icon tcs-round-icon--paper"
                  : "tcs-round-icon tcs-round-icon--info"
              }
              aria-hidden="true"
            >
              {id === "question-paper" ? "≡" : "i"}
            </span>
            {label(id)}
          </button>
        ))}
      </span>
    </div>
  );
}
