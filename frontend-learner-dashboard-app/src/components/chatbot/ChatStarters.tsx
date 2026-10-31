import React, { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Broadcast,
  CalendarCheck,
  ChartBar,
  ClipboardText,
  Exam,
  Lightbulb,
  ListChecks,
  PlayCircle,
  Question,
  Sparkle,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ChatStarter } from "@/services/chatbot-api";
import { useChatbotContext } from "./useChatbotContext";
import { ChatSuggestions } from "./ChatSuggestions";

/** At most this many starter cards. */
const MAX_STARTERS = 4;
/** How long each "Try saying" example stays up. */
const TRY_SAYING_MS = 4000;

const STARTER_ICONS: Record<string, React.ElementType> = {
  explain: Lightbulb,
  quiz: Exam,
  course: BookOpen,
  live: Broadcast,
  task: ListChecks,
  resume: PlayCircle,
  test: ClipboardText,
  plan: CalendarCheck,
  results: ChartBar,
  doubt: Question,
};

const StarterCard: React.FC<{
  starter: ChatStarter;
  index: number;
  disabled: boolean;
  onPick: (prompt: string) => void;
}> = ({ starter, index, disabled, onPick }) => {
  const reduceMotion = useReducedMotion();
  const Icon = STARTER_ICONS[starter.icon] ?? Sparkle;
  return (
    <motion.li
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: reduceMotion ? 0 : index * 0.05, ease: "easeOut" }}
    >
      <button
        type="button"
        onClick={() => onPick(starter.prompt)}
        disabled={disabled}
        className="group flex w-full items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-start shadow-sm ring-1 ring-border/40 transition-all hover:bg-primary/5 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <Icon className="size-4" weight="duotone" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug text-foreground line-clamp-2">
            {starter.label}
          </span>
          {starter.sublabel && (
            <span className="mt-0.5 block truncate text-caption text-muted-foreground">
              {starter.sublabel}
            </span>
          )}
        </span>
        <ArrowRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-primary motion-safe:group-hover:translate-x-0.5 rtl:rotate-180 rtl:motion-safe:group-hover:-translate-x-0.5"
          aria-hidden="true"
        />
      </button>
    </motion.li>
  );
};

/** One example request at a time, cycling every few seconds. */
const TrySaying: React.FC<{ examples: string[] }> = ({ examples }) => {
  const { t } = useTranslation("chatFeatureB");
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (examples.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % examples.length), TRY_SAYING_MS);
    return () => clearInterval(timer);
  }, [examples]);

  const example = examples[index % examples.length];
  if (!example) return null;
  return (
    <p className="flex min-h-5 items-center gap-1 ps-1 text-caption text-muted-foreground">
      <span className="shrink-0">{t("starters.trySaying")}</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={example}
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
          transition={{ duration: reduceMotion ? 0 : 0.25 }}
          className="min-w-0 truncate italic text-foreground/80"
        >
          “{example}”
        </motion.span>
      </AnimatePresence>
    </p>
  );
};

const StarterSkeleton: React.FC = () => {
  const { t } = useTranslation("chatFeatureB");
  return (
    <ul className="flex flex-col gap-2" aria-busy="true" aria-label={t("starters.loading")}>
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border/30">
          <span className="size-9 shrink-0 rounded-lg bg-muted motion-safe:animate-pulse" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="h-3 w-3/5 rounded bg-muted motion-safe:animate-pulse" />
            <span className="h-2.5 w-2/5 rounded bg-muted/70 motion-safe:animate-pulse" />
          </span>
        </li>
      ))}
    </ul>
  );
};

/**
 * The empty chat's personal starters: up to four one-tap cards made for the
 * learner's page and day, then a rotating "Try saying" example. Falls back to
 * the route's quick actions when the starters cannot be loaded.
 */
export const ChatStarters: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation("chatFeatureB");
  const { starters, startersState, openAndSend, isLoading } = useChatbotContext();
  const cards = (starters?.starters ?? []).slice(0, MAX_STARTERS);
  // A refresh keeps the cards on screen; the skeleton is only for a first load.
  const loading = cards.length === 0 && (startersState === "loading" || startersState === "idle");
  const failed = !loading && cards.length === 0;

  return (
    <section className={cn("flex flex-col gap-2 ps-7", className)} aria-label={t("starters.label")}>
      {loading ? (
        <StarterSkeleton />
      ) : failed ? (
        <ChatSuggestions completeOnly />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {cards.map((starter, i) => (
              <StarterCard
                key={`${starter.icon}-${starter.label}`}
                starter={starter}
                index={i}
                disabled={isLoading}
                onPick={openAndSend}
              />
            ))}
          </ul>
          {starters && starters.try_saying.length > 0 && <TrySaying examples={starters.try_saying} />}
          <ChatSuggestions voiceOnly />
        </>
      )}
    </section>
  );
};
