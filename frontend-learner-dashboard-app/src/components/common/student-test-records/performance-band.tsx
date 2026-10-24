// "Where you stand" — a single horizontal marks scale (0 → total) with the
// class range shaded and markers for the learner, the class average and the
// topper. Mirrors the score-band chart on the printed report so the on-screen
// report reads like the official document.

import { useTranslation } from "react-i18next";

interface PerformanceBandProps {
  studentMarks: number | null;
  averageMarks: number | null;
  highestMarks: number | null;
  lowestMarks: number | null;
  totalMarks: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function pct(value: number, total: number) {
  return Math.min(Math.max((value / total) * 100, 0), 100);
}

export function PerformanceBand({
  studentMarks,
  averageMarks,
  highestMarks,
  lowestMarks,
  totalMarks,
}: PerformanceBandProps) {
  const { t } = useTranslation("testRecords");
  if (totalMarks == null || totalMarks <= 0 || studentMarks == null) {
    return null;
  }

  const you = pct(studentMarks, totalMarks);
  const avg = averageMarks != null ? pct(averageMarks, totalMarks) : null;
  const top = highestMarks != null ? pct(highestMarks, totalMarks) : null;
  const low = lowestMarks != null ? pct(lowestMarks, totalMarks) : 0;

  // Quarter ticks along the axis, labelled in marks.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    left: f * 100,
    label: round1(totalMarks * f),
  }));

  return (
    <div>
      <div className="relative mt-2 h-8">
        {/* Full scale */}
        <div className="absolute inset-x-0 top-2 h-4 rounded-sm bg-muted" />
        {/* Class range (lowest → topper) */}
        {top != null && (
          <div
            className="absolute top-2 h-4 bg-primary-100"
            /* Dynamic chart geometry — values come from live marks data. */
            style={{ left: `${low}%`, width: `${Math.max(top - low, 0)}%` }}
          />
        )}
        {/* Class average marker */}
        {avg != null && (
          <div
            className="absolute top-1 h-6 w-0.5 bg-neutral-500"
            style={{ left: `${avg}%` }}
            title={t("common.classAverageValue", { value: round1(averageMarks!) })}
          />
        )}
        {/* Topper marker */}
        {top != null && (
          <div
            className="absolute top-1 h-6 w-0.5 bg-success-500"
            style={{ left: `${top}%` }}
            title={t("performanceBand.tooltip.classTopper", { value: round1(highestMarks!) })}
          />
        )}
        {/* Your marker — drawn last so it stays on top */}
        <div
          className="absolute top-0 h-8 w-1 rounded-full bg-primary-500"
          style={{ left: `calc(${you}% - 2px)` }}
          title={t("performanceBand.tooltip.you", { value: round1(studentMarks) })}
        />
      </div>

      {/* Axis */}
      <div className="relative mt-1 h-4">
        {ticks.map((t) => (
          <span
            key={t.left}
            className="absolute -translate-x-1/2 text-3xs tabular-nums text-muted-foreground first:translate-x-0 last:-translate-x-full"
            style={{ left: `${t.left}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption text-muted-foreground">
        <LegendItem swatch="bg-primary-500" label={t("common.you")} value={round1(studentMarks)} />
        {averageMarks != null && (
          <LegendItem
            swatch="bg-neutral-500"
            label={t("performanceBand.legend.classAverage")}
            value={round1(averageMarks)}
          />
        )}
        {highestMarks != null && (
          <LegendItem
            swatch="bg-success-500"
            label={t("performanceBand.legend.classTopper")}
            value={round1(highestMarks)}
          />
        )}
      </div>
    </div>
  );
}

function LegendItem({
  swatch,
  label,
  value,
}: {
  swatch: string;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-0.5 rounded-full ${swatch}`} />
      {label}
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  );
}
