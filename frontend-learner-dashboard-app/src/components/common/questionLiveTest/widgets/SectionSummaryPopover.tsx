import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { LEGEND_LABEL_KEY } from "./Legend";
import type { StatusCounts } from "./palette-logic";
import type { QuestionStatus } from "../question-status-colors";

const ORDER: QuestionStatus[] = [
  "answered",
  "not-answered",
  "not-visited",
  "marked",
  "answered-marked",
];

/**
 * The round "i" on a group or section tab. Hover or focus shows the name and
 * how many questions are in each state. The popover is placed on a fixed
 * layer under the icon, because the tab strip scrolls and would clip it.
 */
export function SectionSummaryPopover({
  title,
  counts,
}: {
  title: string;
  counts: StatusCounts;
}) {
  const { t } = useTranslation("questionTest");
  const popoverId = useId();
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
  };
  const hide = () => setAnchor(null);

  return (
    // Not a button: it does nothing when pressed. Focus or hover shows the
    // summary, which the icon points at with aria-describedby.
    <span
      className="tcs-info"
      tabIndex={0}
      role="img"
      aria-label={t("examThemes.tcs.sectionSummary", { name: title })}
      aria-describedby={anchor ? popoverId : undefined}
      onPointerEnter={(event) => show(event.currentTarget)}
      onPointerLeave={hide}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={hide}
    >
      i
      {anchor && (
        <span
          id={popoverId}
          className="tcs-popover"
          role="tooltip"
          style={{ top: anchor.top, left: anchor.left }} // design-lint-ignore: measured anchor position
        >
          <strong className="tcs-popover__title">{title}</strong>
          {ORDER.map((status) => (
            <span key={status} className="tcs-popover__row">
              <span>{t(LEGEND_LABEL_KEY[status])}</span>
              <span className="tcs-popover__count">{counts[status]}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
