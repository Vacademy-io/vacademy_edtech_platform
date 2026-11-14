import { useTranslation } from "react-i18next";
import { useConsole } from "../layouts/console-context";
import { singleLanguageOption } from "./language-option";

/**
 * Blue bar above the question. Per preset (`chrome.viewInBar`) the console
 * either always shows a "View in" language select (disabled while the paper
 * has one language), shows the bar empty for a single-language paper, or has
 * no bar unless the paper exists in more than one language. The learner
 * preview carries no language variants today, so a single-language paper is
 * the usual case.
 */
export function ViewInBar({
  languages = [],
  value,
  onChange,
}: {
  languages?: { code: string; label: string }[];
  value?: string;
  onChange?: (code: string) => void;
}) {
  const { t, i18n } = useTranslation("questionTest");
  const { chrome } = useConsole();
  const multi = languages.length > 1;
  if (!multi && chrome.viewInBar === "when-languages") return null;
  const showSelect = multi || chrome.viewInBar === "select";
  const options = multi ? languages : [singleLanguageOption(i18n.language)];
  return (
    <div className="tcs-viewin">
      {showSelect && (
        <label className="tcs-viewin__label">
          {t("examThemes.tcs.viewIn")} :
          <select
            className="tcs-viewin__select"
            value={multi ? value : options[0]?.code}
            disabled={!multi}
            onChange={(event) => onChange?.(event.target.value)}
          >
            {options.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
