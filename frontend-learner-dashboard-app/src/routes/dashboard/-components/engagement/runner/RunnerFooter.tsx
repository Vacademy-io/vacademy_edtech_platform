import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, Star, WarningCircle } from "@phosphor-icons/react";
import iconPoints from "@/assets/cleaner-play/icon-points.webp";
import { MyButton } from "@/components/design-system/button";
import { ecn, skinClasses } from "../engagement-tone";
import { GateChecklist, type GateItem } from "./GateChecklist";

/**
 * The runner's sticky footer (D8, D19, D26, D54): one primary action with the
 * reward line beside it, and above them either what still gates the action or
 * the server's reason for refusing it. After the task is done: the result, then
 * "Next: {title}" and a way back. `.pb-safe` keeps the button clear of the
 * home indicator on phones.
 */

export interface RunnerCta {
  label: string;
  /** Rendered `aria-disabled` (still focusable, so the checklist can explain why). */
  disabled: boolean;
  busy?: boolean;
  onClick: () => void;
}

export interface RunnerFooterProps {
  phase: "answer" | "done";
  /** answer: what still gates the action. */
  gate?: GateItem[] | null;
  /** answer: the server's refusal, already mapped from its reasonCode. */
  error?: string | null;
  /** answer: "+10 now · +20 if correct"; empty when gamification is off. */
  rewardLine?: string;
  /** answer: a chip beside the reward line, e.g. a game's "3 / 4". */
  scoreChip?: string | null;
  cta?: RunnerCta | null;
  /** answer: a quiet secondary action, e.g. "Game not loading? Mark complete". */
  secondary?: { label: string; onClick: () => void } | null;
  /** done: the full result. */
  result?: ReactNode;
  /** done: the next task, when there is one. */
  next?: { title: string; onClick: () => void } | null;
  /** done: close the runner. */
  onBack: () => void;
  backLabel: string;
  nextLabel: (title: string) => string;
  /** done: move focus to the primary button (the action the learner used is gone). */
  focusOnDone?: boolean;
  className?: string;
}

export function RunnerFooter({
  phase,
  gate,
  error,
  rewardLine,
  scoreChip,
  cta,
  secondary,
  result,
  next,
  onBack,
  backLabel,
  nextLabel,
  focusOnDone,
  className,
}: RunnerFooterProps) {
  const navRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (phase !== "done" || !focusOnDone) return;
    navRef.current?.querySelector<HTMLButtonElement>("button[data-primary]")?.focus();
  }, [phase, focusOnDone]);

  return (
    <footer
      className={ecn(
        "shrink-0 border-t bg-background pb-safe shadow-sm",
        skinClasses("divider"),
        "[.ui-cleaner-play_&]:bg-cp-surface",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:px-6">
        {phase === "done" ? (
          <>
            {result}
            <div ref={navRef} className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {next ? (
                <>
                  <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    className="h-11 min-h-11 min-w-0"
                    onClick={onBack}
                  >
                    {backLabel}
                  </MyButton>
                  <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    className="h-11 min-h-11 w-full min-w-0 max-w-full sm:w-auto sm:max-w-sm"
                    data-primary=""
                    onClick={next.onClick}
                  >
                    <span dir="auto" className="min-w-0 truncate">
                      {nextLabel(next.title)}
                    </span>
                    <ArrowRight aria-hidden weight="bold" className="size-4 shrink-0 rtl:-scale-x-100" />
                  </MyButton>
                </>
              ) : (
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="large"
                  className="h-11 min-h-11 w-full min-w-0 sm:w-auto sm:min-w-44"
                  data-primary=""
                  onClick={onBack}
                >
                  {backLabel}
                </MyButton>
              )}
            </div>
          </>
        ) : (
          <>
            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 text-caption font-medium text-danger-700 [.ui-play_&]:text-play-danger-soft-ink [.ui-cleaner-play_&]:text-cp-terracotta"
              >
                <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 break-words">{error}</span>
              </p>
            ) : (
              gate && gate.length > 0 && <GateChecklist items={gate} />
            )}

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                {rewardLine && (
                  <p className={ecn("flex min-w-0 items-center gap-1.5 text-body font-medium tabular-nums", skinClasses("ink"))}>
                    {/* The same mark as the header's points chip, so "+10" reads as points. */}
                    <Star
                      aria-hidden
                      weight="fill"
                      className="size-4 shrink-0 text-primary-500 [.ui-cleaner-play_&]:hidden [.ui-corporate_&]:text-muted-foreground [.ui-play_&]:hidden"
                    />
                    <img
                      src={iconPoints}
                      alt=""
                      aria-hidden
                      className="hidden size-5 shrink-0 [.ui-cleaner-play_&]:inline-block [.ui-play_&]:inline-block"
                    />
                    <span className="min-w-0">{rewardLine}</span>
                  </p>
                )}
                {scoreChip && (
                  <span
                    className={ecn(
                      "rounded-full border px-2 py-0.5 text-caption font-semibold tabular-nums",
                      skinClasses("divider"),
                      skinClasses("ink")
                    )}
                  >
                    {scoreChip}
                  </span>
                )}
                {secondary && (
                  <button
                    type="button"
                    onClick={secondary.onClick}
                    className={ecn(
                      "min-h-11 text-caption underline underline-offset-2 hover:no-underline",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                      skinClasses("mutedInk")
                    )}
                  >
                    {secondary.label}
                  </button>
                )}
              </div>
              {cta && (
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="large"
                  aria-disabled={cta.disabled || cta.busy || undefined}
                  aria-busy={cta.busy || undefined}
                  onClick={() => {
                    if (!cta.disabled && !cta.busy) cta.onClick();
                  }}
                  className={ecn(
                    "h-11 min-h-11 w-full min-w-0 shrink-0 sm:w-auto sm:min-w-44",
                    "aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:active:scale-100"
                  )}
                >
                  <span className="min-w-0 truncate">{cta.label}</span>
                </MyButton>
              )}
            </div>
          </>
        )}
      </div>
    </footer>
  );
}
