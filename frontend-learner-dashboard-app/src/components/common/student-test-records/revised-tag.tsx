import { PencilSimpleLine } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

/**
 * "Revised 18 Nov" chip (spec W11, Phase 1a).
 *
 * The server sends `result_revised_at` only for a RELEASED attempt whose marks a
 * teacher changed after release, so the tag shows exactly when the learner is
 * looking at marks that differ from what was first released. The new marks are
 * already live; the tag only says so.
 */
interface RevisedTagProps {
  /** `result_revised_at` from the report list row or the report detail. */
  at?: string | number | null;
  className?: string;
}

export const RevisedTag = ({ at, className }: RevisedTagProps) => {
  const { t } = useTranslation("testRecords");
  if (at == null || at === "") return null;
  const date = formatDate(at);
  return (
    <span
      data-testid="revised-tag"
      title={t("revisedTagHint")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-info-200 bg-info-50 px-2 py-0.5 text-2xs font-medium text-info-700",
        className
      )}
    >
      <PencilSimpleLine className="size-3 shrink-0" aria-hidden="true" weight="bold" />
      {date ? t("revisedTag", { date }) : t("revisedTagShort")}
    </span>
  );
};

export default RevisedTag;
