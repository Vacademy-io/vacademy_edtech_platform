import React, { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowsClockwise, CaretLeft, CaretRight, Shuffle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { FlashcardsCardData } from "../types";
import { ChatMarkdown } from "../MessageBubble";

const NAV_BUTTON =
  "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Both faces share one grid cell, so the card is as tall as its longer side. */
const FACE =
  "[grid-area:1/1] flex min-h-28 flex-col items-center justify-center gap-1 rounded-xl px-4 py-4 text-center [backface-visibility:hidden]";

const shuffled = (length: number): number[] => {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
};

/**
 * Flashcards one at a time: tap (or Space / Enter) flips the card, arrows
 * move between cards, Shuffle mixes the deck. Under reduced motion the flip
 * is a crossfade.
 */
export const FlashcardsCard: React.FC<{ card: FlashcardsCardData }> = ({ card }) => {
  const { t } = useTranslation("chatFeatureB");
  const reduceMotion = useReducedMotion();
  const total = card.items.length;
  const [order, setOrder] = useState<number[]>(() => card.items.map((_, i) => i));
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const item = card.items[order[position] ?? 0] ?? card.items[0];
  if (!item) return null;

  const go = (next: number) => {
    setPosition(Math.max(0, Math.min(total - 1, next)));
    setFlipped(false);
  };

  const flipLabel = flipped ? t("cards.flashcards.showFront") : t("cards.flashcards.showBack");
  const sideLabel = flipped ? t("cards.flashcards.back") : t("cards.flashcards.front");

  const front = (
    <>
      <span className="text-2xs font-semibold uppercase tracking-wide text-primary">
        {t("cards.flashcards.front")}
      </span>
      <div className="text-sm font-medium text-foreground">
        <ChatMarkdown>{item.front}</ChatMarkdown>
      </div>
    </>
  );
  const back = (
    <>
      <span className="text-2xs font-semibold uppercase tracking-wide text-primary">
        {t("cards.flashcards.back")}
      </span>
      <div className="text-sm text-foreground">
        <ChatMarkdown>{item.back}</ChatMarkdown>
      </div>
    </>
  );

  return (
    <section
      className="overflow-hidden rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-border/30"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const forward = (e.key === "ArrowRight") !== (document.documentElement.dir === "rtl");
          e.preventDefault();
          go(position + (forward ? 1 : -1));
        }
      }}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {card.title || t("cards.flashcards.title")}
        </h3>
        <span className="shrink-0 text-caption font-medium tabular-nums text-muted-foreground" aria-live="polite">
          {t("cards.flashcards.counter", { n: position + 1, total })}
        </span>
      </header>

      <div className="px-3 [perspective:1000px]">
        {/* A div, not a <button>: the faces hold block markdown (and maybe links). */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFlipped((f) => !f)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              setFlipped((f) => !f);
            }
          }}
          aria-pressed={flipped}
          aria-label={`${sideLabel}. ${flipLabel}`}
          className="block w-full cursor-pointer select-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {reduceMotion ? (
            <div className="grid">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={`${position}-${flipped ? "back" : "front"}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className={cn(FACE, flipped ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/50 ring-1 ring-border/50")}
                >
                  {flipped ? back : front}
                </motion.div>
              </AnimatePresence>
            </div>
          ) : (
            <motion.div
              key={position}
              className="grid [transform-style:preserve-3d]"
              initial={{ rotateY: 0 }}
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
            >
              <div className={cn(FACE, "bg-muted/50 ring-1 ring-border/50")} aria-hidden={flipped}>
                {front}
              </div>
              <div
                className={cn(FACE, "bg-primary/10 ring-1 ring-primary/30 [transform:rotateY(180deg)]")}
                aria-hidden={!flipped}
              >
                {back}
              </div>
            </motion.div>
          )}
        </div>
        <p className="mt-1.5 flex items-center justify-center gap-1 text-2xs text-muted-foreground">
          <ArrowsClockwise className="size-3" aria-hidden="true" />
          {t("cards.flashcards.tapToFlip")}
        </p>
      </div>

      <footer className="mt-1 flex items-center gap-1 border-t border-border/50 px-2 py-1.5">
        <button
          type="button"
          onClick={() => go(position - 1)}
          disabled={position === 0}
          aria-label={t("cards.flashcards.previous")}
          title={t("cards.flashcards.previous")}
          className={NAV_BUTTON}
        >
          <CaretLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        </button>
        <span className="flex flex-1 items-center justify-center gap-1" aria-hidden="true">
          {card.items.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === position ? "w-3 bg-primary" : "w-1.5 bg-muted-foreground/25",
              )}
            />
          ))}
        </span>
        {total > 2 && (
          <button
            type="button"
            onClick={() => {
              setOrder(shuffled(total));
              setPosition(0);
              setFlipped(false);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Shuffle className="size-3.5" aria-hidden="true" />
            {t("cards.flashcards.shuffle")}
          </button>
        )}
        <button
          type="button"
          onClick={() => go(position + 1)}
          disabled={position >= total - 1}
          aria-label={t("cards.flashcards.next")}
          title={t("cards.flashcards.next")}
          className={NAV_BUTTON}
        >
          <CaretRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
};
