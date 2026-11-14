import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Circle, CircleNotch } from "@phosphor-icons/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { markSlideCompletion } from "@/services/study-library/tracking-api/mark-slide-completion";
import { getSlideCompletionThreshold } from "@/constants/study-library";

/**
 * Slide types a learner may complete by hand.
 *
 * Consumption content only. Quizzes, questions, assignments and assessments
 * complete by submission — declaring those done would claim a score that was
 * never earned, and the backend refuses them anyway. Mainstream players draw
 * the same line: Udemy and Coursera let you tick a lecture or a reading, never
 * a graded item. SCORM is included because many packages are reading screens
 * that never report completion; the package's own report still counts too.
 */
export const MANUALLY_COMPLETABLE_SLIDE_TYPES: ReadonlySet<string> = new Set([
  "VIDEO",
  "HTML_VIDEO",
  "AUDIO",
  "DOCUMENT",
  "SCORM",
]);

export interface CompletionContext {
  chapterId?: string;
  moduleId?: string;
  subjectId?: string;
  packageSessionId?: string;
}

/**
 * Explicit completion toggle for the current slide.
 *
 * Mirrors the control mainstream course players put beside a lesson: it shows
 * the slide's real state (so a video already watched past the threshold reads
 * as complete without the learner touching it), and lets them set or clear it
 * by hand for everything automatic tracking cannot see.
 *
 * Optimistic — the write is a rollup cascade on the backend, so waiting on it
 * would leave the button dead for a beat on every click. A failure reverts and
 * says so rather than leaving a lie on screen.
 */
export const MarkCompleteButton = ({
  slideId,
  slideType,
  percentageCompleted,
  context,
  compact = false,
}: {
  slideId: string;
  slideType: string;
  percentageCompleted: number;
  context: CompletionContext;
  compact?: boolean;
}) => {
  const { t } = useTranslation("studyContent");
  const queryClient = useQueryClient();
  const [override, setOverride] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // Drop the optimistic value when the learner moves to another slide, so the
  // next slide shows its own state rather than inheriting this one's.
  useEffect(() => {
    setOverride(null);
  }, [slideId]);

  const serverComplete = percentageCompleted >= getSlideCompletionThreshold();
  const isComplete = override ?? serverComplete;

  const onToggle = async () => {
    if (saving) return;
    const next = !isComplete;
    setOverride(next);
    setSaving(true);
    try {
      await markSlideCompletion({
        slideId,
        slideType,
        completed: next,
        ...context,
      });
      // Refresh the slide list so ticks, chapter progress and any drip unlock
      // this completion satisfies all pick the change up.
      if (context.chapterId) {
        queryClient.invalidateQueries({
          queryKey: ["slides", context.chapterId],
        });
      }
    } catch {
      setOverride(!next);
      toast.error(
        next
          ? "Could not mark this as complete. Please try again."
          : "Could not update this. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const label = isComplete
    ? t("slideNav.completed")
    : t("slideNav.markComplete");

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={saving}
      aria-pressed={isComplete}
      aria-label={
        isComplete
          ? t("slideNav.completedAria")
          : t("slideNav.markCompleteAria")
      }
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60",
        isComplete
          ? "border-success-200 bg-success-50 text-success-600 hover:bg-success-100"
          : "border-neutral-200 bg-white text-neutral-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700",
        "[.ui-play_&]:rounded-xl [.ui-play_&]:border-2 [.ui-play_&]:font-bold"
      )}
    >
      {saving ? (
        <CircleNotch size={14} className="animate-spin" />
      ) : isComplete ? (
        <CheckCircle size={14} weight="fill" />
      ) : (
        <Circle size={14} />
      )}
      <span className={cn(compact && "hidden sm:inline")}>{label}</span>
    </button>
  );
};
