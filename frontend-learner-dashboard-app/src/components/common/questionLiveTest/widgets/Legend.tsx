import { useTranslation } from "react-i18next";
import type { QuestionStatus } from "../question-status-colors";
import { ChipShape } from "./PaletteChip";
import type { StatusCounts } from "./palette-logic";

const LEGEND_LABEL_KEY: Record<QuestionStatus, string> = {
  answered: "examThemes.tcs.legend.answered",
  "not-answered": "examThemes.tcs.legend.notAnswered",
  "not-visited": "examThemes.tcs.legend.notVisited",
  marked: "examThemes.tcs.legend.marked",
  "answered-marked": "examThemes.tcs.legend.answeredMarked",
};

/** Status legend with live counts for the open section (two columns). */
export function Legend({
  order,
  counts,
}: {
  order: QuestionStatus[];
  counts: StatusCounts;
}) {
  const { t } = useTranslation("questionTest");
  return (
    <ul className="tcs-legend" aria-label={t("examThemes.tcs.legend.ariaLabel")}>
      {order.map((status) => (
        <li
          key={status}
          className={
            status === "answered-marked"
              ? "tcs-legend__item tcs-legend__item--wide"
              : "tcs-legend__item"
          }
        >
          <ChipShape status={status} size="legend">
            {counts[status]}
          </ChipShape>
          <span className="tcs-legend__label">{t(LEGEND_LABEL_KEY[status])}</span>
        </li>
      ))}
    </ul>
  );
}

export { LEGEND_LABEL_KEY };
