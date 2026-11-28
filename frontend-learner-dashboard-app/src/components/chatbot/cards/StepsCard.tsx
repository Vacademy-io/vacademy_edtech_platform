import React, { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CaretDown, Check } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { StepsCardData } from "../types";
import { ChatMarkdown } from "../MessageBubble";

/**
 * A worked answer revealed one step at a time: step 1 is open, later steps
 * stay collapsed until "Show next step" (or "Show all", or tapping one).
 * Revealed steps can be folded and reopened by tapping their title.
 */
export const StepsCard: React.FC<{ card: StepsCardData }> = ({ card }) => {
  const { t } = useTranslation("chatFeatureB");
  const reduceMotion = useReducedMotion();
  const total = card.items.length;
  /** How many steps have been revealed (always at least the first). */
  const [revealed, setRevealed] = useState(1);
  /** Revealed steps the learner folded away again. */
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const allShown = revealed >= total;

  const toggle = (index: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <section className="overflow-hidden rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-border/30">
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {card.title || t("cards.steps.title")}
        </h3>
        <span className="sr-only">{t("cards.steps.progress", { shown: revealed, total })}</span>
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
          {card.items.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i < revealed ? "w-3 bg-primary" : "w-1.5 bg-muted-foreground/25",
              )}
            />
          ))}
        </span>
      </header>

      <ol className="flex flex-col">
        {card.items.map((step, i) => {
          const isRevealed = i < revealed;
          const open = isRevealed && !collapsed.has(i);
          const done = i < revealed - 1;
          return (
            <li key={i} className="border-t border-border/50">
              <button
                type="button"
                onClick={() => (isRevealed ? toggle(i) : setRevealed(i + 1))}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                  !isRevealed && "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular-nums transition-colors",
                    !isRevealed
                      ? "bg-muted text-muted-foreground"
                      : done
                        ? "bg-primary/15 text-primary"
                        : "bg-primary text-primary-foreground",
                  )}
                >
                  {done ? <Check className="size-3" weight="bold" aria-hidden="true" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {step.title || t("cards.steps.stepN", { n: i + 1 })}
                </span>
                <CaretDown
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
              <AnimatePresence initial={false}>
                {open && step.body && (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="ps-10 pe-3 pb-2.5 text-sm">
                      <ChatMarkdown>{step.body}</ChatMarkdown>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>

      {!allShown && (
        <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2">
          <button
            type="button"
            onClick={() => setRevealed((n) => Math.min(total, n + 1))}
            className="inline-flex h-7 items-center rounded-lg bg-primary px-3 text-caption font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("cards.steps.next", { n: revealed + 1, total })}
          </button>
          <button
            type="button"
            onClick={() => setRevealed(total)}
            className="inline-flex h-7 items-center rounded-lg px-2 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("cards.steps.showAll")}
          </button>
        </div>
      )}
    </section>
  );
};
