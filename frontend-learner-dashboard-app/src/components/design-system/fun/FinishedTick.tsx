import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * A finished course keeps its own colour and gets this: a white disc with a
 * green check (styles/fun/base.css, .fun-tick). Pair it with <ReviewLabel />.
 *
 * OWNER DEFAULT (unconfirmed): finished = own colour + tick + green "Review".
 */
export function FinishedTick({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  const { t } = useTranslation("funCommon");
  return (
    <svg
      className={cn("fun-tick", className)}
      viewBox="0 0 20 20"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": t("done") })}
    >
      <circle className="fun-tick__disc" cx="10" cy="10" r="10" />
      <path className="fun-tick__check" d="M5.5 10.5 L8.5 13.5 L14.5 7" />
    </svg>
  );
}

/** The green "Review" label a finished course carries. */
export function ReviewLabel({ className }: { className?: string }) {
  const { t } = useTranslation("funCommon");
  return <span className={cn("fun-review", className)}>{t("review")}</span>;
}
