import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface LockNoticeProps {
  /** Why the content is still closed, e.g. "Unlocks in 4 days (12 Sep)". */
  message?: string | null;
  className?: string;
}

/**
 * Inline "why is this locked" line for content cards.
 *
 * Deliberately not a tooltip: on the card-only course layout most learners are
 * on a phone, where a hover tooltip never opens and a lock icon with no reason
 * next to it just reads as broken.
 *
 * Carries no padlock of its own — the card already shows one centred on the
 * thumbnail, and two locks on one card is one lock too many.
 */
export function LockNotice({ message, className }: LockNoticeProps) {
  const { t } = useTranslation("courseComponentsExtra");
  return (
    <p className={cn("text-caption text-muted-foreground", className)}>
      {message || t("dripConditions.common.locked")}
    </p>
  );
}
