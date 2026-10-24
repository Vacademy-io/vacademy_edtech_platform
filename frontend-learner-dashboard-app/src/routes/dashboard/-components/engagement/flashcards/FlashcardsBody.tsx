import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  Cards,
  CheckCircle,
  CircleNotch,
  Info,
  Lightbulb,
  Repeat,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { celebrate, celebrationKindFor } from "@/lib/play-celebration";
import type { EngagementItem, EngagementSubmitResponse, FlashcardResult } from "@/services/engagement";
import { ecn, skinClasses } from "../engagement-tone";
import { FlipCard, type FlipCardSide } from "./FlipCard";
import { FlashcardCounts, FlashcardProgressBar, FlashcardsSummary } from "./FlashcardsSummary";
import { currentCardId, useFlashcardSession } from "./use-flashcard-session";

/**
 * The native FLASHCARDS study body (flashcards spec B2), mounted by the task
 * runner. It owns its rating footer; the runner hides its own footer CTA.
 *
 * Contract with the runner:
 * - the runner opens the task with GET item/{id} (which records the server
 *   start) and passes that item here;
 * - after the first pass the body submits `{cardOutcomes, itemVersion}` through
 *   `useSubmitEngagement` and shows its own summary;
 * - `onComplete(response)` fires when the learner presses Next on the summary.
 *   A deck finished before this open shows its summary read-only and Next hands
 *   back a stand-in response with `alreadyCompleted: true`;
 * - `onSubmitted(response)`, optional, fires as soon as the server accepts, for
 *   a runner that wants to update its header before Next.
 *
 * Input: tap / click / Space / Enter / the Flip button flips; after the first
 * flip, Got it and Still learning (keys 2 and 1, or the arrow towards that
 * button's side, mirrored in RTL, or a swipe) rate the card; Undo reverts the
 * last rating.
 */

export interface FlashcardsBodyProps {
  item: EngagementItem;
  onComplete: (resp: EngagementSubmitResponse) => void;
  /** Fires once, as soon as the server accepts the first pass. */
  onSubmitted?: (resp: EngagementSubmitResponse) => void;
  /** Show the points (gamification on). Default true. */
  showPoints?: boolean;
  className?: string;
}

/** Literal play / clay classes layered on MyButton for the two ratings. */
const LEARNING_BUTTON =
  "h-11 min-w-0 flex-1 gap-2 px-3 [.ui-play_&]:rounded-play-btn [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-warn-deep [.ui-play_&]:bg-play-warn-soft [.ui-play_&]:!text-play-warn-soft-ink [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:active:border-b-2 [.ui-cleaner-play_&]:rounded-full [.ui-cleaner-play_&]:border-cp-gold [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-cleaner-play_&]:!text-cp-ink";
const GOT_IT_BUTTON =
  "h-11 min-w-0 flex-1 gap-2 px-3 [.ui-play_&]:rounded-play-btn [.ui-play_&]:bg-play-success [.ui-play_&]:hover:bg-play-success [.ui-play_&]:shadow-play-4d-success [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:active:shadow-none [.ui-cleaner-play_&]:rounded-full";
const FLIP_BUTTON =
  "h-11 w-full min-w-0 gap-2 [.ui-play_&]:rounded-play-btn [.ui-play_&]:shadow-play-4-primary [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:active:shadow-none [.ui-cleaner-play_&]:rounded-full";

/** The runner's body padding, as its other bodies use. */
const PAD = "px-4 py-5 sm:px-6";

const KBD =
  "hidden min-w-5 items-center justify-center rounded border border-current px-1 text-caption font-medium leading-none opacity-70 md:inline-flex";

function isTypingTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function readRtl(el: Element | null): boolean {
  if (typeof window === "undefined") return false;
  const target = el ?? document.documentElement;
  try {
    return window.getComputedStyle(target).direction === "rtl";
  } catch {
    return document.documentElement.dir === "rtl";
  }
}

export function FlashcardsBody({ item, onComplete, onSubmitted, showPoints = true, className }: FlashcardsBodyProps) {
  const { t, i18n } = useTranslation("dashboardEngagement");
  const session = useFlashcardSession(item, { onSubmitted });
  const isPlay = usePlayTheme();
  const isCleanerPlay = useCleanerPlayTheme();

  const rootRef = useRef<HTMLDivElement>(null);
  const cardElRef = useRef<HTMLButtonElement | null>(null);
  // A callback ref that never clears: the exiting card unmounts after the new
  // one has mounted and must not null the pointer to the live card.
  const setCardEl = useCallback((el: HTMLButtonElement | null) => {
    if (el) cardElRef.current = el;
  }, []);

  // Reading direction of the body itself (swipe and arrows mirror in RTL).
  const [rtl, setRtl] = useState(() => readRtl(null));
  useLayoutEffect(() => {
    setRtl(readRtl(rootRef.current));
  }, [i18n.language]);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setRtl(readRtl(rootRef.current)));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["dir", "lang"] });
    return () => observer.disconnect();
  }, []);

  const [exitSide, setExitSide] = useState<FlipCardSide | null>(null);
  const [showResumed, setShowResumed] = useState(session.resumed);

  const { phase, round, current, isPractice } = session;
  const studying = phase === "study" || phase === "practice";
  const canRate = studying && round.seen && current != null;

  const rateWith = useCallback(
    (result: FlashcardResult) => {
      if (!canRate) return;
      setExitSide(result === "KNOWN" ? "end" : "start");
      setShowResumed(false);
      session.rate(result);
    },
    [canRate, session]
  );

  const flip = useCallback(() => {
    if (!studying) return;
    setShowResumed(false);
    session.flip();
  }, [studying, session]);

  const undo = useCallback(() => {
    setExitSide(null);
    session.undo();
  }, [session]);

  // Keyboard: Space / Enter flip, 1 / 2 rate, arrows rate towards that side.
  useEffect(() => {
    if (!studying) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const root = rootRef.current;
      if (!root || !root.isConnected) return;
      const target = e.target instanceof Element ? e.target : null;
      if (isTypingTarget(target)) return;
      const inside = target ? root.contains(target) : false;
      const neutral =
        !target ||
        target === document.body ||
        target === document.documentElement ||
        target.getAttribute("role") === "dialog";
      if (!inside && !neutral) return;
      const onCard = target != null && target === cardElRef.current;
      const onOtherButton = inside && !onCard && target?.closest("button") != null;

      switch (e.key) {
        case " ":
        case "Enter":
          // The card and every other button already act on their own key press.
          if (onCard || onOtherButton) return;
          e.preventDefault();
          flip();
          return;
        case "1":
          if (!canRate) return;
          e.preventDefault();
          rateWith("LEARNING");
          return;
        case "2":
          if (!canRate) return;
          e.preventDefault();
          rateWith("KNOWN");
          return;
        case "ArrowRight":
        case "ArrowLeft": {
          if (!canRate) return;
          e.preventDefault();
          // Got it sits at the reading-order end: right in LTR, left in RTL.
          const isRtl = readRtl(root);
          const towardsEnd = (e.key === "ArrowRight") !== isRtl;
          rateWith(towardsEnd ? "KNOWN" : "LEARNING");
          return;
        }
        default:
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [studying, canRate, flip, rateWith]);

  // Keep keyboard focus on the live card as cards change (the old one unmounts).
  const liveId = current?.id ?? null;
  useEffect(() => {
    if (!studying || !liveId) return;
    const root = rootRef.current;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    // Lost: nothing, the page, or the runner Sheet itself (Radix focuses the
    // dialog on open), so Space goes straight to the card.
    const focusIsLost =
      !active || active === document.body || (root != null && active !== root && active.contains(root));
    const focusInside = root != null && active != null && root.contains(active);
    if (!focusIsLost && !focusInside) return;
    const id = requestAnimationFrame(() => cardElRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [liveId, studying, round.flipped]);

  // Play skins celebrate a fresh completion once, when the summary lands
  // (never with gamification off, never for a deck finished earlier).
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (!showPoints || phase !== "summary" || session.readOnly || !session.result || celebratedRef.current) return;
    celebratedRef.current = true;
    const kind = celebrationKindFor(session.result);
    if (kind) celebrate(kind, { skin: isPlay ? "play" : isCleanerPlay ? "cleanerPlay" : "other" });
  }, [showPoints, phase, session.readOnly, session.result, isPlay, isCleanerPlay]);

  const next = () => {
    if (session.result) onComplete(session.result);
  };

  // ── Views ─────────────────────────────────────────────────────────

  if (phase === "loading") {
    return (
      <div ref={rootRef} className={ecn("flex flex-col gap-4", PAD, className)} aria-busy="true">
        <span className="sr-only" role="status">
          {t("runner.flashcards.loading")}
        </span>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-1.5 w-full" />
        <Skeleton className="h-80 w-full rounded-2xl sm:h-96" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div
        ref={rootRef}
        className={ecn("flex flex-col items-center gap-3 px-4 py-10 text-center sm:px-6", className)}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep">
          <Cards aria-hidden weight="duotone" className="size-6" />
        </span>
        <p className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>{t("runner.flashcards.emptyTitle")}</p>
        <p className={ecn("max-w-sm text-body", skinClasses("mutedInk"))}>{t("runner.flashcards.emptyBody")}</p>
      </div>
    );
  }

  if ((phase === "summary" || phase === "practiceDone") && session.summary) {
    const practiceView = phase === "practiceDone" && session.practiceSummary != null;
    return (
      <div ref={rootRef} className={ecn("flex flex-col", PAD, className)}>
        <FlashcardsSummary
          mode={practiceView ? "practice" : "summary"}
          data={practiceView && session.practiceSummary ? session.practiceSummary : session.summary}
          order={practiceView ? round.order : session.readOnly ? undefined : session.firstPass.order}
          ratings={practiceView ? round.ratings : session.readOnly ? undefined : session.firstPass.ratings}
          result={session.result}
          showPoints={showPoints}
          readOnly={session.readOnly}
          onStudyAgain={() => {
            setExitSide(null);
            session.startPractice();
          }}
          onReviewAll={() => {
            setExitSide(null);
            session.startPractice(session.deck?.cards.map((c) => c.id) ?? []);
          }}
          onBackToSummary={session.backToSummary}
          onNext={next}
        />
      </div>
    );
  }

  // Study view: the first pass, the practice round, and the finishing states.
  const busy = phase === "finishing" || phase === "syncing";
  const hintAvailable = Boolean(current?.hint) && !round.hintShown && !round.flipped;
  const counterLabel = isPractice
    ? t("runner.flashcards.practiceCardOf", { current: session.position, total: session.total })
    : t("runner.flashcards.cardOf", { current: session.position, total: session.total });

  return (
    // overflow-x-clip: a swiped card flies past the edge without a scrollbar flash.
    <div ref={rootRef} className={ecn("flex min-w-0 flex-col gap-4 overflow-x-clip", PAD, className)}>
      {/* Header: position, running counts, Undo. */}
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          {/* Not a live region: focus follows the card, whose name says "Card 4 of 12". */}
          <p className={ecn("min-w-0 truncate text-body font-semibold tabular-nums", skinClasses("ink"))}>
            {counterLabel}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <FlashcardCounts known={session.counts.known} learning={session.counts.learning} />
            <MyButton
              type="button"
              buttonType="text"
              scale="small"
              className="h-8 min-w-0 gap-1 px-2 text-caption"
              disable={!session.canUndo}
              onClick={undo}
              aria-label={t("runner.flashcards.undoAria")}
            >
              <ArrowCounterClockwise aria-hidden weight="bold" className="size-4 rtl:-scale-x-100" />
              <span className="hidden xs:inline">{t("runner.flashcards.undo")}</span>
            </MyButton>
          </div>
        </div>
        <FlashcardProgressBar
          order={round.order}
          ratings={round.ratings}
          currentId={currentCardId(round)}
          label={t("runner.flashcards.progressAria", {
            rated: session.counts.known + session.counts.learning,
            total: session.total,
          })}
        />
      </div>

      {session.cardsUpdated && !isPractice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-info-200 bg-info-50 px-3 py-2 text-info-700 [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-info-soft [.ui-play_&]:text-play-info-soft-ink [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-ink"
        >
          <Info aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 flex-1 text-caption">{t("runner.flashcards.cardsUpdated")}</p>
          <button
            type="button"
            onClick={session.dismissCardsUpdated}
            aria-label={t("runner.flashcards.dismiss")}
            className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-info-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [.ui-play_&]:hover:bg-transparent"
          >
            <X aria-hidden weight="bold" className="size-3.5" />
          </button>
        </div>
      )}

      {showResumed && !session.cardsUpdated && !isPractice && (
        <p role="status" className={ecn("flex items-center gap-1.5 text-caption", skinClasses("mutedInk"))}>
          <ArrowsClockwise aria-hidden weight="bold" className="size-3.5" />
          {t("runner.flashcards.resume")}
        </p>
      )}

      {/* The card. */}
      <FlipCard
        ref={setCardEl}
        card={current}
        flipped={studying ? round.flipped : false}
        canRate={canRate}
        hintShown={round.hintShown}
        position={session.position}
        total={session.total}
        onFlip={flip}
        onSwipe={(side) => rateWith(side === "end" ? "KNOWN" : "LEARNING")}
        exitSide={exitSide}
        rtl={rtl}
        practice={isPractice}
        emptyStage={
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-success-50 text-success-700 [.ui-play_&]:bg-play-success-soft [.ui-play_&]:text-play-success-soft-ink [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-sage">
              <Cards aria-hidden weight="fill" className="size-6" />
            </span>
            <p className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
              {t("runner.flashcards.allRated", { count: session.total })}
            </p>
          </div>
        }
      />

      {/* Under the card: the hint, and the keyboard legend on wide screens. */}
      {studying && current && (
        // On a phone the legend is hidden, so the row only takes space for the hint.
        <div
          className={ecn(
            "min-h-8 flex-wrap items-center justify-between gap-2",
            hintAvailable ? "flex" : "hidden md:flex"
          )}
        >
          {hintAvailable ? (
            <MyButton
              type="button"
              buttonType="text"
              scale="small"
              className="h-8 min-w-0 gap-1.5 px-1 text-caption"
              onClick={session.showHint}
            >
              <Lightbulb aria-hidden weight="bold" className="size-4" />
              {t("runner.flashcards.showHint")}
            </MyButton>
          ) : (
            <span />
          )}
          <p className={ecn("hidden text-caption md:block", skinClasses("mutedInk"))}>
            {round.seen ? t("runner.flashcards.keysRate") : t("runner.flashcards.flipHint")}
          </p>
        </div>
      )}

      {/* Footer: Flip, then the ratings; or the finishing / error state. */}
      <div className="sticky bottom-0 z-10 -mx-1 bg-background px-1 pb-safe [.ui-cleaner-play_&]:bg-cp-surface">
        <div className="flex flex-col gap-2 pb-1 pt-2">
          {studying && !round.seen && (
            <MyButton type="button" buttonType="primary" scale="large" className={FLIP_BUTTON} onClick={flip}>
              <ArrowsClockwise aria-hidden weight="bold" className="size-4" />
              {t("runner.flashcards.flip")}
              <kbd className={KBD}>{t("runner.flashcards.keySpace")}</kbd>
            </MyButton>
          )}

          {studying && round.seen && (
            <>
              <p className={ecn("text-center text-caption font-medium", skinClasses("mutedInk"))}>
                {t("runner.flashcards.didYouKnow")}
              </p>
              <div className="flex gap-2">
                <MyButton
                  type="button"
                  buttonType="secondary"
                  scale="large"
                  className={LEARNING_BUTTON}
                  onClick={() => rateWith("LEARNING")}
                >
                  <Repeat aria-hidden weight="bold" className="size-4 shrink-0" />
                  <span className="truncate">{t("runner.flashcards.stillLearning")}</span>
                  <kbd className={KBD}>1</kbd>
                </MyButton>
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="large"
                  className={GOT_IT_BUTTON}
                  onClick={() => rateWith("KNOWN")}
                >
                  <CheckCircle aria-hidden weight="bold" className="size-4 shrink-0" />
                  <span className="truncate">{t("runner.flashcards.gotIt")}</span>
                  <kbd className={KBD}>2</kbd>
                </MyButton>
              </div>
            </>
          )}

          {busy && <FinishingLine phase={phase} finishAt={session.finishAt} submitting={session.submitting} />}

          {phase === "error" && session.error && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-3 text-danger-700 sm:flex-row sm:items-center [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-danger-soft [.ui-play_&]:text-play-danger-soft-ink [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-terracotta-tint [.ui-cleaner-play_&]:text-cp-ink"
            >
              <p className="flex min-w-0 flex-1 items-start gap-2 text-body">
                <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">{session.error.message}</span>
              </p>
              {session.error.retryable && (
                <MyButton
                  type="button"
                  buttonType="secondary"
                  scale="medium"
                  className="h-10 w-full shrink-0 sm:w-auto"
                  onClick={session.retry}
                >
                  {t("runner.flashcards.retry")}
                </MyButton>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Saving your results" with a countdown while the patience gate runs out. */
function FinishingLine({
  phase,
  finishAt,
  submitting,
}: {
  phase: string;
  finishAt: number | null;
  submitting: boolean;
}) {
  const { t } = useTranslation("dashboardEngagement");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (finishAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [finishAt]);

  const seconds = finishAt != null ? Math.max(0, Math.ceil((finishAt - now) / 1000)) : 0;
  let text: string;
  if (phase === "syncing") text = t("runner.flashcards.syncing");
  else if (!submitting && seconds > 0) text = t("runner.flashcards.finishingIn", { count: seconds });
  else text = t("runner.flashcards.finishing");

  return (
    <div role="status" className={ecn("flex min-h-11 items-center justify-center gap-2 text-body", skinClasses("mutedInk"))}>
      <CircleNotch aria-hidden weight="bold" className="size-4 shrink-0 motion-safe:animate-spin" />
      <span>{text}</span>
    </div>
  );
}
