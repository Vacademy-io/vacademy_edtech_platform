import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, CheckCircle, Repeat } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import type { EngagementFlashcard, EngagementSubmitResponse, FlashcardResult } from "@/services/engagement";
import { EngagementResult } from "../EngagementResult";
import { ecn, skinClasses } from "../engagement-tone";
import type { FlashcardSummaryData } from "./use-flashcard-session";

/**
 * The end of a flashcards session (flashcards spec B2, step 5):
 * - "You knew 9 of 12 on the first go" with the points (hidden when
 *   gamification is off), in the shared `EngagementResult`;
 * - the cards still being learned, front and back;
 * - "Study 3 again": a local practice round that is never submitted;
 * - Next, which hands the result back to the runner.
 *
 * `mode="practice"` is the end of a practice round: the same list and actions,
 * with "Back to summary".
 */

// ── Progress bar (shared with the study view) ───────────────────────

/** One segment per card, in study order. Literal classes per skin. */
const SEGMENT_BASE = "h-1.5 min-w-0 flex-1 rounded-full [.ui-play_&]:h-2";
const SEGMENT_KNOWN = "bg-success-500 [.ui-play_&]:bg-play-success [.ui-cleaner-play_&]:bg-cp-sage";
const SEGMENT_LEARNING = "bg-warning-500 [.ui-play_&]:bg-play-warn [.ui-cleaner-play_&]:bg-cp-gold";
const SEGMENT_CURRENT = "bg-primary-300 [.ui-play_&]:bg-play-info [.ui-cleaner-play_&]:bg-cp-terracotta";
const SEGMENT_EMPTY = "bg-muted [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep";

export interface FlashcardProgressBarProps {
  /** Card ids in study order. */
  order: readonly string[];
  ratings: Readonly<Record<string, FlashcardResult>>;
  /** Id of the card on screen, drawn as the current segment. */
  currentId?: string | null;
  /** Accessible summary, e.g. "4 of 12 cards rated". */
  label: string;
  className?: string;
}

/**
 * A segmented bar: green for Got it, amber for Still learning, a soft primary
 * for the card on screen. Colour is never the only cue: the counts sit beside it.
 */
export function FlashcardProgressBar({ order, ratings, currentId, label, className }: FlashcardProgressBarProps) {
  const rated = order.reduce((n, id) => (ratings[id] ? n + 1 : n), 0);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={order.length}
      aria-valuenow={rated}
      className={ecn("flex w-full items-center", order.length > 24 ? "gap-px" : "gap-1", className)}
    >
      {order.map((id) => {
        const r = ratings[id];
        return (
          <span
            key={id}
            className={ecn(
              SEGMENT_BASE,
              r === "KNOWN"
                ? SEGMENT_KNOWN
                : r === "LEARNING"
                  ? SEGMENT_LEARNING
                  : id === currentId
                    ? SEGMENT_CURRENT
                    : SEGMENT_EMPTY
            )}
          />
        );
      })}
    </div>
  );
}

/** "Got it 9 · Still learning 3" with icons, for the header and the summary. */
export function FlashcardCounts({
  known,
  learning,
  className,
}: {
  known: number;
  learning: number;
  className?: string;
}) {
  const { t } = useTranslation("dashboardEngagement");
  return (
    <p className={ecn("flex items-center gap-3 text-caption font-medium tabular-nums", skinClasses("mutedInk"), className)}>
      {/* aria-label is not announced on a paragraph: the name is real (sr-only) text. */}
      <span className="sr-only">{t("runner.flashcards.countsAria", { known, learning })}</span>
      <span aria-hidden className="inline-flex items-center gap-1">
        <CheckCircle
          weight="fill"
          className="size-4 text-success-600 [.ui-play_&]:text-play-success [.ui-cleaner-play_&]:text-cp-sage"
        />
        {known}
      </span>
      <span aria-hidden className="inline-flex items-center gap-1">
        <Repeat
          weight="bold"
          className="size-4 text-warning-600 [.ui-play_&]:text-play-warn [.ui-cleaner-play_&]:text-cp-gold"
        />
        {learning}
      </span>
    </p>
  );
}

// ── Summary ─────────────────────────────────────────────────────────

export interface FlashcardsSummaryProps {
  /** `summary`: after the first pass. `practice`: after a practice round. */
  mode: "summary" | "practice";
  data: FlashcardSummaryData;
  /** Study order, for the bar (the summary's cards when absent). */
  order?: readonly string[];
  ratings?: Readonly<Record<string, FlashcardResult>>;
  /** The submit result (summary mode). */
  result?: EngagementSubmitResponse | null;
  /** Points line on or off (gamification). Default true. */
  showPoints?: boolean;
  /** Opened on a deck finished earlier. */
  readOnly?: boolean;
  /** Study the still-learning cards again (local only). */
  onStudyAgain: () => void;
  /** Go through every card again (local only), when nothing is left to learn. */
  onReviewAll: () => void;
  /** Practice mode: back to the first-pass summary. */
  onBackToSummary?: () => void;
  onNext: () => void;
  className?: string;
}

/** Literal skin classes for the still-learning rows. */
const ROW =
  "flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-card py-3 [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border-2 [.ui-play_&]:border-play-surface [.ui-cleaner-play_&]:border-cp-border [.ui-corporate_&]:rounded-md";

export function FlashcardsSummary({
  mode,
  data,
  order,
  ratings,
  result,
  showPoints = true,
  readOnly,
  onStudyAgain,
  onReviewAll,
  onBackToSummary,
  onNext,
  className,
}: FlashcardsSummaryProps) {
  const { t } = useTranslation("dashboardEngagement");
  const titleId = useId();
  const learningCount = data.learning.length;
  const known = data.known;

  let detail: string;
  if (known == null) detail = t("runner.flashcards.summaryNoStats");
  else if (mode === "practice") detail = t("runner.flashcards.practiceScore", { known, total: data.total });
  else if (known >= data.total) detail = t("runner.flashcards.summaryAll", { count: data.total });
  else detail = t("runner.flashcards.summary", { known, total: data.total });

  // A bar from the round when we have it, else rebuilt from the counts.
  const barOrder =
    order && order.length
      ? order
      : known != null
        ? Array.from({ length: data.total }, (_, i) => `s${i}`)
        : [];
  const barRatings: Record<string, FlashcardResult> =
    order && order.length && ratings
      ? { ...ratings }
      : Object.fromEntries(barOrder.map((id, i) => [id, i < (known ?? 0) ? "KNOWN" : "LEARNING"]));

  return (
    <section className={ecn("flex min-w-0 flex-col gap-section", className)} aria-labelledby={titleId}>
      <h3 id={titleId} className="sr-only">
        {mode === "practice" ? t("runner.flashcards.practiceDone") : t("runner.flashcards.summaryTitle")}
      </h3>

      {mode === "summary" ? (
        <EngagementResult
          variant="full"
          outcome="done"
          points={result?.pointsAwarded ?? null}
          showPoints={showPoints && !readOnly && !result?.alreadyCompleted}
          detail={detail}
        />
      ) : (
        <div role="status" className="flex min-w-0 flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-500 [.ui-play_&]:bg-play-info-soft [.ui-play_&]:text-play-info-soft-ink [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-sage motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-150">
            <Repeat aria-hidden weight="bold" className="size-6" />
          </span>
          <p className={ecn("text-title font-semibold", skinClasses("ink"))}>{t("runner.flashcards.practiceDone")}</p>
          <p className={ecn("text-body", skinClasses("mutedInk"))}>{detail}</p>
        </div>
      )}

      {barOrder.length > 0 && known != null && (
        <div className="flex flex-col gap-2">
          <FlashcardProgressBar
            order={barOrder}
            ratings={barRatings}
            label={t("runner.flashcards.summaryBarAria", { known, total: data.total })}
          />
          <FlashcardCounts known={known} learning={Math.max(0, data.total - known)} className="justify-center" />
        </div>
      )}

      {readOnly && mode === "summary" && (
        <p className={ecn("text-center text-caption", skinClasses("mutedInk"))}>{t("runner.flashcards.finishedEarlier")}</p>
      )}

      {learningCount > 0 && (
        <div className="flex min-w-0 flex-col gap-stack">
          <h4 className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
            {t("runner.flashcards.stillLearningTitle", { count: learningCount })}
          </h4>
          <ul className="flex min-w-0 flex-col gap-2">
            {data.learning.map((card: EngagementFlashcard) => (
              <li key={card.id} className={ROW}>
                <span dir="auto" className={ecn("whitespace-pre-wrap break-words text-body font-semibold", skinClasses("ink"))}>
                  {card.front}
                </span>
                <span dir="auto" className={ecn("whitespace-pre-wrap break-words text-body", skinClasses("mutedInk"))}>
                  {card.back}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {learningCount > 0 ? (
            <MyButton
              type="button"
              buttonType="secondary"
              scale="large"
              className="h-11 w-full gap-2 sm:w-auto sm:min-w-0 [.ui-play_&]:rounded-play-btn [.ui-cleaner-play_&]:rounded-full"
              onClick={onStudyAgain}
            >
              <Repeat aria-hidden weight="bold" className="size-4" />
              {t("runner.flashcards.studyAgain", { count: learningCount })}
            </MyButton>
          ) : (
            <MyButton
              type="button"
              buttonType="secondary"
              scale="large"
              className="h-11 w-full gap-2 sm:w-auto sm:min-w-0 [.ui-play_&]:rounded-play-btn [.ui-cleaner-play_&]:rounded-full"
              onClick={onReviewAll}
            >
              <Repeat aria-hidden weight="bold" className="size-4" />
              {t("runner.flashcards.reviewAll")}
            </MyButton>
          )}
          <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            className="h-11 w-full gap-2 sm:w-auto sm:min-w-0 [.ui-play_&]:rounded-play-btn [.ui-play_&]:shadow-play-4-primary [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:active:shadow-none [.ui-cleaner-play_&]:rounded-full"
            onClick={onNext}
          >
            {t("runner.flashcards.continue")}
            <ArrowRight aria-hidden weight="bold" className="size-4 rtl:-scale-x-100" />
          </MyButton>
        </div>
        {mode === "practice" && onBackToSummary ? (
          <MyButton type="button" buttonType="text" scale="medium" className="self-center" onClick={onBackToSummary}>
            {t("runner.flashcards.backToSummary")}
          </MyButton>
        ) : readOnly ? null : (
          <p className={ecn("text-center text-caption", skinClasses("mutedInk"))}>{t("runner.flashcards.practiceOnly")}</p>
        )}
      </div>
    </section>
  );
}
