import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * A course progress bar. `band`: on a course-coloured band, highlight yellow on
 * the course's track. `plain`: on white, the course colour on its tint. Put it
 * inside an element with a fun-course-N class. Show the percent as text next to
 * a `band` bar, as every board does: the yellow against some tracks is below
 * 3:1, so the bar alone must not carry the reading.
 *
 * A percent that is not known (null or undefined) draws nothing, never 0%.
 */
export function FunProgress({
  percent,
  tone = "plain",
  label,
  className,
}: {
  percent: number | null | undefined;
  tone?: "band" | "plain";
  /** The accessible name; defaults to "Progress". */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation("funCommon");
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return null;
  const value = Math.round(Math.max(0, Math.min(100, percent)));
  return (
    <div
      role="progressbar"
      aria-label={label ?? t("progress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("fun-progress", tone === "band" && "fun-progress--band", className)}
    >
      {/* The width is the reading itself, so it cannot be a class. */}
      <div className="fun-progress__fill" style={{ width: `${value}%` }} />
    </div>
  );
}
