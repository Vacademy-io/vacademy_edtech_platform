import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check, CheckCircle, Circle, LockSimple, XCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { Progress } from "@/components/ui/progress";
import { ecn, outcomeClasses, skinClasses, toneClasses, type EngagementTone } from "./engagement-tone";
import { POLL_MIN_RESPONSES, pollShares, type EngagementPollResult } from "./engagement-copy";

/**
 * Answer options for a multiple-choice question or a poll (D7, D25, D41).
 *
 * - `answer` / `vote`: a real radio group (Radix: roving tabindex, arrow keys).
 *   Picking an option only selects it; the learner commits with the Check /
 *   Vote button, so a mis-tap while scrolling is never graded. Enter selects
 *   too, so "Tab to an option, Enter, Tab, Enter" answers from the keyboard.
 * - `result`: after submitting. Marks the pick right or wrong; marks the
 *   correct option only when the server sent `correctId`.
 * - `revealed`: after the reveal, with the key.
 * - `pollResults`: bars per option; percentages only from 5 responses.
 *
 * The selected option carries a check mark and a heavier border, so the choice
 * never depends on colour alone.
 */

export interface ChoiceOption {
  id: string;
  text: string;
}

export type ChoiceMode = "answer" | "vote" | "result" | "revealed" | "pollResults";

export interface ChoiceOptionsProps {
  options: ChoiceOption[];
  mode: ChoiceMode;
  selectedId?: string | null;
  /** The correct option, when the server has sent it. */
  correctId?: string | null;
  /** `result` without a key: whether the pick was right (null = held back). */
  selectedCorrect?: boolean | null;
  pollResults?: EngagementPollResult[] | null;
  responseCount?: number | null;
  /** Id of the element holding the question, for `aria-labelledby`. */
  promptId?: string;
  onSelect?: (optionId: string) => void;
  /** Renders the Check / Vote button under the options when given. */
  onConfirm?: () => void;
  /** The confirm request is in flight. */
  confirming?: boolean;
  /** Overrides "Check" / "Vote". */
  confirmLabel?: string;
  disabled?: boolean;
  /** `rail`: one column, compact. `main`: two columns from sm. */
  size?: "rail" | "main";
  tone?: EngagementTone;
  className?: string;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function letterFor(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

type OptionStatus = "idle" | "picked" | "correct" | "wrong" | "key";

export function ChoiceOptions({
  options,
  mode,
  selectedId,
  correctId,
  selectedCorrect,
  pollResults,
  responseCount,
  promptId,
  onSelect,
  onConfirm,
  confirming,
  confirmLabel,
  disabled,
  size = "main",
  tone = "info",
  className,
}: ChoiceOptionsProps) {
  const { t } = useTranslation("dashboardEngagement");
  if (options.length === 0) return null;

  const grid = size === "main" ? "grid gap-2 sm:grid-cols-2" : "grid gap-2";
  const padding = size === "main" ? "min-h-11 px-3 py-2.5" : "min-h-11 px-3 py-2";
  const interactive = mode === "answer" || mode === "vote";

  if (interactive) {
    const onKeyDown = (optionId: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
      // Radix follows the ARIA radio pattern, where Enter does nothing; here
      // Enter selects, and never submits. Capture phase, because Radix's item
      // replaces any onKeyDown passed to it.
      if (event.key === "Enter") {
        event.preventDefault();
        if (!disabled) onSelect?.(optionId);
      }
    };
    return (
      <div className={ecn("flex min-w-0 flex-col gap-3", className)}>
        <RadioGroupPrimitive.Root
          value={selectedId ?? ""}
          onValueChange={(value) => onSelect?.(value)}
          disabled={disabled}
          aria-labelledby={promptId}
          className={grid}
        >
          {options.map((option, index) => (
            <RadioGroupPrimitive.Item
              key={option.id}
              value={option.id}
              onKeyDownCapture={onKeyDown(option.id)}
              className={ecn(
                "group relative z-10 flex w-full min-w-0 items-center gap-3 rounded-lg text-start transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400",
                "disabled:cursor-not-allowed disabled:opacity-60",
                "aria-checked:font-medium",
                padding,
                toneClasses(tone, "option")
              )}
            >
              <span
                aria-hidden
                className={ecn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold",
                  "border-border bg-muted text-muted-foreground",
                  "group-aria-checked:border-primary-500 group-aria-checked:bg-primary-500 group-aria-checked:text-primary-foreground",
                  "[.ui-play_&]:group-aria-checked:border-transparent [.ui-play_&]:group-aria-checked:bg-play-info [.ui-play_&]:group-aria-checked:text-white",
                  "[.ui-cleaner-play_&]:group-aria-checked:border-transparent [.ui-cleaner-play_&]:group-aria-checked:bg-cp-ink [.ui-cleaner-play_&]:group-aria-checked:text-cp-surface"
                )}
              >
                <span className="group-aria-checked:hidden">{letterFor(index)}</span>
                <Check weight="bold" className="hidden size-3.5 group-aria-checked:block" />
              </span>
              <span dir="auto" className={ecn("min-w-0 flex-1 break-words text-body", skinClasses("ink"))}>
                {option.text}
              </span>
              <RadioGroupPrimitive.Indicator className="shrink-0">
                <CheckCircle aria-hidden weight="fill" className="size-5 text-primary-500 [.ui-play_&]:text-play-info-deep [.ui-cleaner-play_&]:text-cp-ink" />
              </RadioGroupPrimitive.Indicator>
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root>

        {onConfirm && (
          <MyButton
            type="button"
            buttonType="primary"
            scale="medium"
            className={ecn("min-h-11 w-full sm:w-auto sm:self-start", size === "rail" && "sm:w-full")}
            disable={!selectedId || disabled || confirming}
            aria-busy={confirming || undefined}
            onClick={onConfirm}
          >
            {confirming
              ? t("choice.checking")
              : (confirmLabel ?? (mode === "vote" ? t("choice.vote") : t("choice.check")))}
          </MyButton>
        )}
      </div>
    );
  }

  // --- Read-only modes ------------------------------------------------------------

  const statusOf = (optionId: string): OptionStatus => {
    const picked = optionId === selectedId;
    if (mode === "pollResults") return picked ? "picked" : "idle";
    if (correctId) {
      if (optionId === correctId) return picked ? "correct" : "key";
      return picked ? "wrong" : "idle";
    }
    if (!picked) return "idle";
    if (selectedCorrect === true) return "correct";
    if (selectedCorrect === false) return "wrong";
    return "picked";
  };

  const shares =
    mode === "pollResults"
      ? pollShares(
          options.map((o) => o.id),
          pollResults,
          responseCount
        )
      : null;
  const total =
    typeof responseCount === "number" && responseCount > 0
      ? responseCount
      : (shares ?? []).reduce((acc, s) => acc + (s.count ?? 0), 0);
  const showPercents = shares?.some((s) => s.percent != null) ?? false;

  const statusClasses: Record<OptionStatus, string> = {
    idle: "border-border bg-card opacity-80 [.ui-cleaner-play_&]:border-cp-border",
    picked: outcomeClasses("pending", "option"),
    correct: outcomeClasses("correct", "option"),
    wrong: outcomeClasses("wrong", "option"),
    key: outcomeClasses("correct", "option"),
  };

  return (
    <div className={ecn("flex min-w-0 flex-col gap-2", className)}>
      <ul aria-labelledby={promptId} className={mode === "pollResults" ? "grid gap-2" : grid}>
        {options.map((option, index) => {
          const status = statusOf(option.id);
          const share = shares?.[index] ?? null;
          const StatusIcon =
            status === "correct" || status === "key"
              ? CheckCircle
              : status === "wrong"
                ? XCircle
                : status === "picked" && mode !== "pollResults"
                  ? LockSimple
                  : status === "picked"
                    ? CheckCircle
                    : Circle;
          const srStatus =
            status === "correct"
              ? t("choice.yourAnswerCorrect")
              : status === "wrong"
                ? t("choice.yourAnswerWrong")
                : status === "key"
                  ? t("choice.correctAnswer")
                  : status === "picked"
                    ? mode === "pollResults"
                      ? t("choice.yourVote")
                      : t("choice.yourAnswer")
                    : null;
          return (
            <li
              key={option.id}
              className={ecn(
                "flex min-w-0 flex-col gap-1.5 rounded-lg border",
                status === "idle" ? "border" : "border-2",
                padding,
                statusClasses[status]
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className={ecn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
                    status === "idle"
                      ? "bg-muted text-muted-foreground"
                      : outcomeClasses(
                          status === "key" ? "correct" : status === "picked" ? "pending" : status,
                          "circle"
                        )
                  )}
                >
                  {status === "idle" ? (
                    letterFor(index)
                  ) : (
                    <StatusIcon weight="fill" className="size-4" />
                  )}
                </span>
                <span dir="auto" className={ecn("min-w-0 flex-1 break-words text-body", skinClasses("ink"))}>
                  {option.text}
                  {srStatus && <span className="sr-only">{` (${srStatus})`}</span>}
                </span>
                {share && share.percent != null && (
                  <span className={ecn("shrink-0 text-body font-semibold tabular-nums", skinClasses("ink"))}>
                    {t("choice.percent", { percent: share.percent })}
                  </span>
                )}
              </div>
              {share && showPercents && (
                <Progress
                  aria-hidden
                  value={share.percent ?? 0}
                  // Progress slides its bar in from the left; mirror it for RTL.
                  className="h-1.5 bg-muted rtl:-scale-x-100 [.ui-cleaner-play_&]:bg-cp-bg-deep"
                />
              )}
            </li>
          );
        })}
      </ul>
      {mode === "pollResults" && (
        <p className={ecn("text-caption", skinClasses("mutedInk"))}>
          {showPercents
            ? t("choice.responses", { count: total })
            : t("choice.tooFewVotes", { count: POLL_MIN_RESPONSES })}
        </p>
      )}
    </div>
  );
}
