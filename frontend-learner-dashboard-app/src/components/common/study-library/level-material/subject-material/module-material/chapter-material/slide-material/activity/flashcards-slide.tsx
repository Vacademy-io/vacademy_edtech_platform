import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowCounterClockwise, CheckCircle, Repeat } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { getUserId } from "@/constants/getUserId";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import { markSlideCompletion } from "@/services/study-library/tracking-api/mark-slide-completion";
import type { Slide } from "@/hooks/study-library/use-slides";
import type { FlashcardResult } from "@/services/engagement";
import { FlipCard, type FlipCardSide } from "@/routes/dashboard/-components/engagement/flashcards/FlipCard";
import {
  FlashcardCounts,
  FlashcardProgressBar,
} from "@/routes/dashboard/-components/engagement/flashcards/FlashcardsSummary";
import {
  currentCardId,
  deckOrder,
  isRoundComplete,
  newRound,
  ratedCount,
  roundCounts,
  roundReducer,
  type FlashcardRound,
  type FlashcardRoundAction,
} from "@/routes/dashboard/-components/engagement/flashcards/use-flashcard-session";
import type { CompletionContext } from "../mark-complete-button";
import { parseFlashcardsSlide } from "./activity-utils";

type RoundState = { round: FlashcardRound; practice: boolean };
type Action = FlashcardRoundAction | { type: "start"; order: string[]; practice: boolean };

function reducer(state: RoundState, action: Action): RoundState {
  if (action.type === "start") return { round: newRound(action.order), practice: action.practice };
  return { ...state, round: roundReducer(state.round, action) };
}

/**
 * A course deck: the daily-engagement flip card and rating, without points. Finishing
 * the first pass through the deck completes the slide; practice rounds on the cards
 * still being learnt are just for the learner.
 */
export function FlashcardsSlide({
  slide,
  completionContext,
}: {
  slide: Slide;
  completionContext?: CompletionContext;
}) {
  const { t, i18n } = useTranslation("dashboardEngagement");
  const queryClient = useQueryClient();
  const rtl = i18n.dir() === "rtl";
  const deck = useMemo(
    () => parseFlashcardsSlide(slide.document_slide?.published_data),
    [slide.document_slide?.published_data]
  );
  const fullOrder = useMemo(
    () => (deck ? deckOrder(deck.cards, deck.shuffle, `${getUserId() ?? ""}:${slide.id}`) : []),
    [deck, slide.id]
  );
  const [state, dispatch] = useReducer(reducer, { round: newRound(fullOrder), practice: false });
  const [exitSide, setExitSide] = useState<FlipCardSide | null>(null);
  const [firstPass, setFirstPass] = useState<{ known: number; learning: string[] } | null>(null);
  const cards = useMemo(() => new Map((deck?.cards ?? []).map((c) => [c.id, c])), [deck]);

  // A republished deck restarts the round.
  useEffect(() => {
    dispatch({ type: "start", order: fullOrder, practice: false });
    setFirstPass(null);
  }, [fullOrder]);

  const { round, practice } = state;
  const done = isRoundComplete(round);
  const cardId = currentCardId(round);
  const card = cardId ? (cards.get(cardId) ?? null) : null;

  const rate = useCallback((result: FlashcardResult) => {
    setExitSide(result === "KNOWN" ? "end" : "start");
    dispatch({ type: "rate", result });
  }, []);

  // The first full pass completes the slide, once.
  const contextRef = useRef(completionContext);
  contextRef.current = completionContext;
  const alreadyComplete = (slide.percentage_completed || 0) >= getSlideCompletionThreshold();
  const markedRef = useRef(false);
  useEffect(() => {
    if (!done || practice || firstPass) return;
    const counts = roundCounts(round);
    setFirstPass({
      known: counts.known,
      learning: round.order.filter((id) => round.ratings[id] === "LEARNING"),
    });
    if (alreadyComplete || markedRef.current) return;
    markedRef.current = true;
    markSlideCompletion({ slideId: slide.id, slideType: "DOCUMENT", completed: true, ...(contextRef.current ?? {}) })
      .then(() => {
        const chapterId = contextRef.current?.chapterId;
        if (chapterId) queryClient.invalidateQueries({ queryKey: ["slides", chapterId] });
      })
      .catch(() => {
        markedRef.current = false;
      });
  }, [done, practice, firstPass, round, alreadyComplete, slide.id, queryClient]);

  // Keyboard: Space flips, 1 / ← still learning, 2 / → got it, as in the daily task.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (done || !card) return;
      if (e.key === " ") {
        e.preventDefault();
        dispatch({ type: "flip" });
      } else if (round.seen && (e.key === "1" || e.key === (rtl ? "ArrowRight" : "ArrowLeft"))) {
        rate("LEARNING");
      } else if (round.seen && (e.key === "2" || e.key === (rtl ? "ArrowLeft" : "ArrowRight"))) {
        rate("KNOWN");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, card, round.seen, rate, rtl]);

  if (!deck) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-subtitle font-semibold text-foreground">{t("runner.flashcards.emptyTitle")}</p>
        <p className="max-w-sm text-body text-muted-foreground">{t("runner.flashcards.emptyBody")}</p>
      </div>
    );
  }

  const counts = roundCounts(round);
  const total = round.order.length;

  if (done) {
    const learning = practice ? round.order.filter((id) => round.ratings[id] === "LEARNING") : (firstPass?.learning ?? []);
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 p-6 text-center">
        <CheckCircle weight="fill" className="size-12 text-success-500" aria-hidden />
        <h2 className="text-h3 font-semibold text-foreground">
          {practice ? t("runner.flashcards.practiceDone") : t("runner.flashcards.summaryTitle")}
        </h2>
        <p className="text-body text-muted-foreground">
          {practice
            ? t("runner.flashcards.practiceScore", { known: counts.known, total })
            : counts.known === total
              ? t("runner.flashcards.summaryAll", { count: total })
              : t("runner.flashcards.summary", { known: counts.known, total })}
        </p>
        <FlashcardProgressBar
          order={round.order}
          ratings={round.ratings}
          label={t("runner.flashcards.summaryBarAria", { known: counts.known, total })}
          className="max-w-sm"
        />
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          {learning.length > 0 && (
            <Button onClick={() => dispatch({ type: "start", order: learning, practice: true })}>
              <Repeat className="me-1.5 size-4" aria-hidden />
              {t("runner.flashcards.studyAgain", { count: learning.length })}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => dispatch({ type: "start", order: fullOrder, practice: true })}
          >
            {t("runner.flashcards.reviewAll")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption font-medium text-muted-foreground tabular-nums">
          {practice
            ? t("runner.flashcards.practiceCardOf", { current: ratedCount(round) + 1, total })
            : t("runner.flashcards.cardOf", { current: ratedCount(round) + 1, total })}
        </p>
        <div className="flex items-center gap-2">
          <FlashcardCounts known={counts.known} learning={counts.learning} />
          {round.log.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: "undo" })}
              aria-label={t("runner.flashcards.undoAria")}
            >
              <ArrowCounterClockwise className="size-4" aria-hidden />
              <span className="ms-1 hidden sm:inline">{t("runner.flashcards.undo")}</span>
            </Button>
          )}
        </div>
      </div>
      <FlashcardProgressBar
        order={round.order}
        ratings={round.ratings}
        currentId={cardId}
        label={t("runner.flashcards.progressAria", { rated: ratedCount(round), total })}
      />
      <FlipCard
        card={card}
        flipped={round.flipped}
        canRate={round.seen}
        hintShown={round.hintShown}
        position={ratedCount(round) + 1}
        total={total}
        onFlip={() => dispatch({ type: "flip" })}
        onSwipe={(side) => rate(side === "end" ? "KNOWN" : "LEARNING")}
        exitSide={exitSide}
        rtl={rtl}
        practice={practice}
      />
      {card?.hint && !round.hintShown && !round.flipped && (
        <Button variant="ghost" size="sm" className="self-center" onClick={() => dispatch({ type: "showHint" })}>
          {t("runner.flashcards.showHint")}
        </Button>
      )}
      {round.seen ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => rate("LEARNING")}>
            <Repeat className="me-1.5 size-4 text-warning-600" aria-hidden />
            {t("runner.flashcards.stillLearning")}
          </Button>
          <Button onClick={() => rate("KNOWN")}>
            <CheckCircle weight="fill" className="me-1.5 size-4" aria-hidden />
            {t("runner.flashcards.gotIt")}
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => dispatch({ type: "flip" })}>
          {t("runner.flashcards.flip")}
        </Button>
      )}
      <p className="text-center text-caption text-muted-foreground">
        {round.seen ? t("runner.flashcards.keysRate") : t("runner.flashcards.flipHint")}
      </p>
    </div>
  );
}
