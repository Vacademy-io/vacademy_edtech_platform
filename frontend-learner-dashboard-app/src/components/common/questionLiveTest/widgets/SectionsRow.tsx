import { useTranslation } from "react-i18next";
import { ConsoleClock } from "./ConsoleClock";

/** White row: "Sections" on the left, Time Left on the right. */
export function SectionsRow() {
  const { t } = useTranslation("questionTest");
  return (
    <div className="tcs-sections-row">
      <span className="tcs-sections-row__label">{t("examThemes.tcs.sections")}</span>
      <ConsoleClock />
    </div>
  );
}
