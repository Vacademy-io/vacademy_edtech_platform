import { useTranslation } from "react-i18next";
import { Sparkle, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { formatVideoTime, useAvailableTutor } from "./tutor-moments";

export interface VideoStuckChipProps {
  /** The spot the learner keeps rewinding to, in seconds. */
  stuckAt: number;
  lessonName?: string | null;
  onDismiss: () => void;
  className?: string;
}

/**
 * A gentle offer near the player: "Stuck at 03:12? Ask Riya". Tapping sends a
 * complete request naming the spot and the lesson; × dismisses it.
 */
export function VideoStuckChip({ stuckAt, lessonName, onDismiss, className }: VideoStuckChipProps) {
  const { t } = useTranslation("chatFeatureB");
  const tutor = useAvailableTutor();
  if (!tutor) return null;
  const time = formatVideoTime(stuckAt);
  const lesson = lessonName?.trim();
  const name = tutor.chatbotSettings.assistant_name;
  return (
    <div
      role="status"
      className={cn(
        "flex max-w-full items-center gap-0.5 rounded-full border border-border bg-card p-1 text-card-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => {
          onDismiss();
          tutor.openAndSend(
            lesson
              ? t("moments.video.prompt", { time, lesson })
              : t("moments.video.promptNoLesson", { time }),
          );
        }}
        className="inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full bg-primary px-3 text-caption font-medium text-primary-foreground transition-colors hover:bg-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Sparkle aria-hidden weight="fill" className="size-3.5 shrink-0" />
        <span className="truncate">{t("moments.video.chip", { time, name })}</span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("moments.video.dismiss")}
        title={t("moments.video.dismiss")}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
