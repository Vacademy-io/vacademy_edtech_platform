import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, LockSimple, XCircle, type Icon } from "@phosphor-icons/react";
import { usePlayTheme } from "@/hooks/use-play-theme";
import iconPoints from "@/assets/cleaner-play/icon-points.webp";
import { ecn, outcomeClasses, skinClasses } from "./engagement-tone";
import { formatClock, type EngagementOutcome } from "./engagement-copy";

/**
 * The result moment after a task is submitted (D24), shared by the Up next
 * row (compact) and the runner footer (full).
 *
 * It is a `role="status"` region so the outcome is announced, and it stays on
 * screen until the caller moves on ("Next task"): it never times out.
 * Confetti is not fired here; the caller gates it on skin and outcome.
 */

const OUTCOME_ICON: Record<EngagementOutcome, Icon> = {
  correct: CheckCircle,
  wrong: XCircle,
  pending: LockSimple,
  done: CheckCircle,
};

export interface EngagementResultProps {
  /** `compact`: one row for the Today module. `full`: the runner's result. */
  variant?: "compact" | "full";
  outcome: EngagementOutcome;
  /** Points awarded by this submit; nothing is drawn for 0 or null. */
  points?: number | null;
  /** When the answer / result is revealed, for "Answer at 8:00 PM". */
  revealAt?: string | null;
  /** The server said the answer was already out: completion points only (D47). */
  answerAlreadyOut?: boolean | null;
  /** An idempotent re-submit of a task already finished. */
  alreadyCompleted?: boolean | null;
  /** Hide the points (gamification off). Default true. */
  showPoints?: boolean;
  /**
   * What the learner handed in, echoed back (TEXT / UPLOAD, D25): the text, or
   * file chips. Shown under `echoLabel` (default "You wrote").
   */
  echo?: ReactNode;
  echoLabel?: string;
  /** Replaces the default second line, e.g. "You knew 9 of 12 on the first go". */
  detail?: ReactNode;
  /** Server "now" for the time formatting. */
  now?: number;
  className?: string;
}

export function EngagementResult({
  variant = "full",
  outcome,
  points,
  revealAt,
  answerAlreadyOut,
  alreadyCompleted,
  showPoints = true,
  echo,
  echoLabel,
  detail,
  now = Date.now(),
  className,
}: EngagementResultProps) {
  const { t } = useTranslation("dashboardEngagement");
  const isPlay = usePlayTheme();
  const OutcomeIcon = OUTCOME_ICON[outcome];

  const revealMs = revealAt ? new Date(revealAt).getTime() : NaN;
  const revealAhead = Number.isFinite(revealMs) && revealMs > now;
  const time = revealAhead ? formatClock(revealAt, now) : "";

  let line: ReactNode = detail ?? null;
  if (line == null) {
    if (alreadyCompleted) line = t("result.alreadyCompleted");
    else if (answerAlreadyOut) line = t("result.answerOut");
    else if (outcome === "wrong" && revealAhead) line = t("reveal.answerAt", { time });
    else if (outcome === "pending")
      line = revealAhead ? t("result.resultAt", { time }) : t("result.resultAtReveal");
  }

  const awarded = typeof points === "number" && points > 0 && showPoints ? points : null;
  const title = t(`result.${outcome}`);

  // Motion: a quiet fade + scale in the standard skins; the play skin's own
  // bounce / wiggle / pop. play-theme.css already parks those for reduced motion.
  const circleMotion = isPlay
    ? outcome === "wrong"
      ? "play-wiggle"
      : "play-bounce-in"
    : "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-150";
  const pointsMotion = isPlay
    ? "play-xp-pop"
    : "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150";

  const pointsMark = awarded != null && (
    <span className={ecn("inline-flex items-baseline gap-1 tabular-nums", pointsMotion)}>
      <img
        src={iconPoints}
        alt=""
        aria-hidden
        className="hidden size-5 self-center [.ui-play_&]:inline-block [.ui-cleaner-play_&]:inline-block"
      />
      <span
        className={ecn(
          variant === "full" ? "text-h2" : "text-subtitle",
          "font-bold",
          skinClasses("ink")
        )}
      >
        {t("result.plus", { count: awarded })}
      </span>
      <span className={ecn("text-caption font-medium", skinClasses("mutedInk"))}>
        <span className="[.ui-play_&]:hidden [.ui-cleaner-play_&]:hidden">
          {t("result.unitPts", { count: awarded })}
        </span>
        <span className="hidden [.ui-play_&]:inline [.ui-cleaner-play_&]:inline">{t("result.unitXp")}</span>
      </span>
    </span>
  );

  const echoBlock = echo != null && (
    <div
      className={ecn(
        "w-full min-w-0 rounded-md border p-3 text-start",
        skinClasses("divider"),
        "bg-muted/40 [.ui-cleaner-play_&]:bg-cp-bg-deep"
      )}
    >
      <p className={ecn("text-caption font-medium", skinClasses("mutedInk"))}>
        {echoLabel ?? t("result.youWrote")}
      </p>
      <div dir="auto" className={ecn("mt-1 whitespace-pre-wrap break-words text-body", skinClasses("ink"))}>
        {echo}
      </div>
    </div>
  );

  if (variant === "compact") {
    return (
      <div role="status" className={ecn("flex min-w-0 flex-col gap-2", className)}>
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={ecn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              outcomeClasses(outcome, "circle"),
              circleMotion
            )}
          >
            <OutcomeIcon aria-hidden weight="fill" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={ecn("text-body font-semibold", outcomeClasses(outcome, "ink"))}>{title}</p>
            {line != null && (
              <p className={ecn("text-caption", skinClasses("mutedInk"))}>{line}</p>
            )}
          </div>
          {pointsMark}
        </div>
        {echoBlock}
      </div>
    );
  }

  return (
    <div
      role="status"
      className={ecn("flex min-w-0 flex-col items-center gap-2 text-center", className)}
    >
      <span
        className={ecn(
          "flex size-12 items-center justify-center rounded-full",
          outcomeClasses(outcome, "circle"),
          circleMotion
        )}
      >
        <OutcomeIcon aria-hidden weight="fill" className="size-7" />
      </span>
      <p className={ecn("text-title font-semibold", outcomeClasses(outcome, "ink"))}>{title}</p>
      {pointsMark}
      {line != null && <p className={ecn("text-body", skinClasses("mutedInk"))}>{line}</p>}
      {echoBlock}
    </div>
  );
}
