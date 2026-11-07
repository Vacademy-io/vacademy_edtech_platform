import { useTranslation } from "react-i18next";
import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  SpeakerHigh,
  Stop,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CitationChip } from "./CompanionVisuals";
import { OPTION_LETTERS } from "./companion-utils";

/** 🔊 Read aloud / stop toggle. */
export function ReadAloudButton({
  active,
  loading,
  onClick,
  compact = false,
  className,
}: {
  active: boolean;
  loading: boolean;
  onClick: () => void;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("kbCompanion");
  const label = active && !loading ? t("voice.stop") : t("voice.readAloud");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
        active
          ? "border-primary-300 bg-primary-50 text-primary-500 dark:bg-primary-500/10"
          : "border-neutral-200 bg-white text-neutral-700 hover:border-primary-300 hover:text-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200",
        className,
      )}
    >
      {loading ? (
        <CircleNotch className="size-4 animate-spin" aria-hidden />
      ) : active ? (
        <Stop weight="fill" className="size-4" aria-hidden />
      ) : (
        <SpeakerHigh weight="duotone" className="size-4" aria-hidden />
      )}
      {!compact && <span>{label}</span>}
      {active && !loading && (
        <span className="flex items-end gap-0.5" aria-hidden>
          <span className="h-2 w-0.5 animate-pulse rounded-full bg-primary-500" />
          <span className="h-3 w-0.5 animate-pulse rounded-full bg-primary-500 delay-150" />
          <span className="h-1.5 w-0.5 animate-pulse rounded-full bg-primary-500 delay-300" />
        </span>
      )}
    </button>
  );
}

export function ErrorPanel({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation("kbCompanion");
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-warning-200 bg-warning-50 px-6 py-8 text-center dark:border-warning-700 dark:bg-warning-700/10",
        className,
      )}
    >
      <WarningCircle className="size-10 text-warning-600" weight="duotone" aria-hidden />
      <p className="max-w-md text-sm font-medium text-neutral-800 dark:text-neutral-100">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <ArrowClockwise className="size-4" aria-hidden />
          {t("actions.retry")}
        </Button>
      )}
    </div>
  );
}

/**
 * Shown while a lesson or practice set is being built. The first learner of a
 * topic can wait a minute or two, so it must feel alive, say how far along it
 * is, and explain that the wait happens only once.
 */
export function PreparingState({
  title,
  headline,
  ready,
  total,
  className,
}: {
  title?: string | null;
  headline: string;
  ready?: number;
  total?: number;
  className?: string;
}) {
  const { t } = useTranslation("kbCompanion");
  const hasCount = typeof ready === "number" && typeof total === "number" && total > 0;
  const building = hasCount ? Math.min(ready + 1, total) : 0;
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-5 rounded-2xl border border-dashed border-primary-200 bg-primary-50/60 px-6 py-10 text-center dark:border-primary-500/30 dark:bg-primary-500/5",
        className,
      )}
      aria-live="polite"
    >
      <div className="relative flex size-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary-200 opacity-40" />
        <span className="absolute inset-2 animate-pulse rounded-full bg-primary-100" />
        <span className="relative text-4xl motion-safe:animate-bounce" aria-hidden>
          ✨
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{headline}</p>
        {title && <p className="text-sm font-medium text-primary-500">{title}</p>}
        {hasCount && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {t("lesson.buildingCard", { current: building, total })}
          </p>
        )}
      </div>
      {hasCount && (
        <div className="flex flex-wrap justify-center gap-1.5" aria-hidden>
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-2 w-6 rounded-full transition-colors duration-500",
                i < ready
                  ? "bg-primary-500"
                  : i === ready
                    ? "animate-pulse bg-primary-300"
                    : "bg-neutral-200 dark:bg-neutral-700",
              )}
            />
          ))}
        </div>
      )}
      <p className="max-w-sm text-xs text-neutral-500 dark:text-neutral-400">{t("lesson.firstTimeHint")}</p>
    </div>
  );
}

/**
 * A four-option question answered with one tap: instant right/wrong, the right
 * answer revealed, and the book's explanation. Used by lesson checks and
 * practice. `picked` is controlled so a revisited card keeps its answer.
 */
export function McqBlock({
  question,
  options,
  answerIndex,
  explanation,
  citation,
  picked,
  onPick,
  isPlay,
}: {
  question: string;
  options: string[];
  answerIndex: number;
  explanation?: string | null;
  citation?: string | null;
  picked: number | null;
  onPick: (index: number, correct: boolean) => void;
  isPlay: boolean;
}) {
  const { t } = useTranslation("kbCompanion");
  const answered = picked !== null;
  const correct = answered && picked === answerIndex;

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold leading-snug text-neutral-900 sm:text-xl dark:text-neutral-50">
        {question}
      </p>
      <div className="grid gap-2.5">
        {options.map((option, i) => {
          const isAnswer = i === answerIndex;
          const isPicked = i === picked;
          const state = !answered
            ? "idle"
            : isAnswer
              ? "right"
              : isPicked
                ? "wrong"
                : "dim";
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => onPick(i, isAnswer)}
              className={cn(
                "group flex w-full items-center gap-3 border-2 px-4 py-3 text-start text-base transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-default",
                isPlay ? "rounded-play-btn" : "rounded-xl",
                state === "idle" &&
                  "border-neutral-200 bg-white hover:-translate-y-0.5 hover:border-primary-300 hover:bg-primary-50 active:translate-y-0 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-primary-500/10",
                state === "right" &&
                  "border-success-500 bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-200",
                state === "wrong" &&
                  "border-danger-400 bg-danger-50 text-danger-700 dark:bg-danger-700/20 dark:text-danger-200",
                state === "dim" && "border-neutral-200 bg-white opacity-50 dark:border-neutral-800 dark:bg-neutral-900",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold",
                  state === "idle" &&
                    "bg-neutral-100 text-neutral-600 group-hover:bg-primary-100 group-hover:text-primary-500 dark:bg-neutral-800 dark:text-neutral-300",
                  state === "right" && "bg-success-500 text-white",
                  state === "wrong" && "bg-danger-500 text-white",
                  state === "dim" && "bg-neutral-100 text-neutral-400 dark:bg-neutral-800",
                )}
                aria-hidden
              >
                {state === "right" ? (
                  <CheckCircle weight="fill" className="size-5" />
                ) : state === "wrong" ? (
                  <XCircle weight="fill" className="size-5" />
                ) : (
                  OPTION_LETTERS[i]
                )}
              </span>
              <span className="min-w-0 flex-1 font-medium">{option}</span>
            </button>
          );
        })}
      </div>

      {answered && (
        <div
          role="status"
          className={cn(
            "animate-in fade-in slide-in-from-bottom-2 space-y-2 rounded-xl border p-4 duration-300",
            correct
              ? "border-success-200 bg-success-50 dark:border-success-700 dark:bg-success-700/10"
              : "border-warning-200 bg-warning-50 dark:border-warning-700 dark:bg-warning-700/10",
          )}
        >
          <p
            className={cn(
              "text-base font-bold",
              correct ? "text-success-700 dark:text-success-200" : "text-warning-700 dark:text-warning-200",
            )}
          >
            {correct
              ? t("check.correct")
              : t("check.incorrect", { letter: OPTION_LETTERS[answerIndex] ?? "" })}
          </p>
          {explanation && (
            <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">{explanation}</p>
          )}
          {citation && <CitationChip label={citation} />}
        </div>
      )}
    </div>
  );
}
