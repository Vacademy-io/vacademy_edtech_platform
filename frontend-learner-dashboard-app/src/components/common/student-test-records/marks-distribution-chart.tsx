import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface MarksDistributionChartProps {
  distribution: Array<{
    marks: number;
    rank: number;
    no_of_participants: number;
    percentile: number;
  }>;
  studentMarks: number | null;
  totalParticipants: number;
}

// Histogram of the whole batch in 10-mark ranges; the learner's own range is
// highlighted. Rendered bare (no card) — the report page provides the ruled
// section heading around it.
export function MarksDistributionChart({
  distribution,
  studentMarks,
  totalParticipants,
}: MarksDistributionChartProps) {
  const { t } = useTranslation("testRecords");
  if (!distribution || distribution.length === 0) return null;

  // Create buckets of 10-mark ranges
  const buckets: { label: string; count: number; min: number; max: number }[] = [];
  const maxMark = Math.max(...distribution.map((d) => d.marks || 0));
  const bucketSize = 10;
  const numBuckets = Math.ceil((maxMark + 1) / bucketSize);

  for (let i = 0; i < numBuckets; i++) {
    const min = i * bucketSize;
    const max = min + bucketSize - 1;
    buckets.push({ label: `${min}–${max}`, count: 0, min, max });
  }

  // Fill buckets
  for (const d of distribution) {
    const marks = d.marks || 0;
    const bucketIndex = Math.floor(marks / bucketSize);
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex].count += d.no_of_participants || 1;
    }
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  // Find student's bucket
  const studentBucketIndex =
    studentMarks != null ? Math.floor(studentMarks / bucketSize) : -1;

  return (
    <div>
      <div
        className="flex items-end gap-1.5 border-b border-border"
        style={{ height: "136px" }}
      >
        {buckets.map((bucket, i) => {
          const heightPx = Math.max((bucket.count / maxCount) * 104, 3);
          const isStudentBucket = i === studentBucketIndex;

          return (
            <div
              key={bucket.label}
              className="flex h-full flex-1 flex-col items-center justify-end"
            >
              <span
                className={cn(
                  "mb-1 text-3xs tabular-nums",
                  isStudentBucket
                    ? "font-semibold text-primary-500"
                    : "text-muted-foreground"
                )}
              >
                {bucket.count}
              </span>
              <div
                className={cn(
                  "w-full rounded-t-sm",
                  isStudentBucket ? "bg-primary-400" : "bg-neutral-200"
                )}
                /* Dynamic chart geometry — height comes from live counts. */
                style={{ height: `${heightPx}px` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5">
        {buckets.map((bucket, i) => (
          <span
            key={bucket.label}
            className={cn(
              "flex-1 text-center text-3xs tabular-nums",
              i === studentBucketIndex
                ? "font-semibold text-primary-500"
                : "text-muted-foreground"
            )}
          >
            {bucket.label}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-primary-400" />
          {t("marksDistributionChart.yourScoreRange")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-neutral-200" />
          {t("marksDistributionChart.restOfBatch")}
        </span>
        <span className="ms-auto tabular-nums">
          {t("common.studentsCount", { count: totalParticipants })}
        </span>
      </div>
    </div>
  );
}
