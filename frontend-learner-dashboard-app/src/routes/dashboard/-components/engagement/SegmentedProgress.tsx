import { useTranslation } from "react-i18next";
import { ecn, skinClasses } from "./engagement-tone";

/**
 * Today's progress as one segment per scheduled task (D5, D41).
 *
 * - The total is the server's `scheduledToday`, so it never moves during the
 *   day; catch-ups never enter it.
 * - Must-do tasks carry a small notch under their segment. Done tasks fill from
 *   the start, so a must-do notch sits under the first `requiredDone` filled
 *   segments and then under the next `requiredOpen` empty ones.
 * - Past {@link MAX_SEGMENTS} tasks the segments would be slivers, so it draws
 *   {@link BUCKETS} equal buckets instead, each a share of the day.
 * - `role="progressbar"` with the count spelled out for screen readers.
 */

/** Above this many tasks the bar is drawn in buckets rather than one segment per task. */
export const MAX_SEGMENTS = 14;
/** Buckets drawn when there are more tasks than {@link MAX_SEGMENTS}. */
export const BUCKETS = 10;

export interface SegmentedProgressProps {
  total: number;
  done: number;
  /** Must-do tasks already done / still open, for the notches. */
  requiredDone?: number;
  requiredOpen?: number;
  className?: string;
}

/** Which segments are filled and which carry a must-do notch. Pure. */
export function segmentModel(
  total: number,
  done: number,
  requiredDone = 0,
  requiredOpen = 0
): { filled: boolean; required: boolean }[] {
  const count = Math.max(0, Math.floor(total));
  const filled = Math.min(count, Math.max(0, Math.floor(done)));
  const out: { filled: boolean; required: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const isFilled = i < filled;
    const required = isFilled ? i < requiredDone : i - filled < requiredOpen;
    out.push({ filled: isFilled, required });
  }
  return out;
}

export function SegmentedProgress({
  total,
  done,
  requiredDone = 0,
  requiredOpen = 0,
  className,
}: SegmentedProgressProps) {
  const { t } = useTranslation("dashboardEngagement");
  if (total <= 0) return null;
  const clampedDone = Math.min(total, Math.max(0, done));
  const label = t("today.progressAria", { done: clampedDone, total });
  // Notches only carry meaning when must-dos and bonus tasks are mixed.
  const requiredCount = requiredDone + requiredOpen;
  const anyRequired = requiredCount > 0 && requiredCount < total;

  // Past MAX_SEGMENTS tasks each segment stands for a share of the day instead
  // of one task (no notches then); the count still reads exactly for screen readers.
  const bucketed = total > MAX_SEGMENTS;
  const segments = bucketed
    ? segmentModel(BUCKETS, Math.round((clampedDone / total) * BUCKETS))
    : segmentModel(total, clampedDone, requiredDone, requiredOpen);
  const notches = anyRequired && !bucketed;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={clampedDone}
      className={ecn("flex w-full items-start gap-1", className)}
    >
      {segments.map((segment, index) => (
        <div key={index} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
          <div
            className={ecn(
              "w-full",
              skinClasses("segmentTrack"),
              segment.filled && skinClasses("segment"),
              segment.filled && "motion-safe:transition-colors motion-safe:duration-300"
            )}
          />
          {notches && (
            <span
              aria-hidden
              className={ecn(
                "size-1 rounded-full",
                segment.required
                  ? "bg-muted-foreground [.ui-play_&]:bg-play-ink/60 [.ui-cleaner-play_&]:bg-cp-muted"
                  : "bg-transparent"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
