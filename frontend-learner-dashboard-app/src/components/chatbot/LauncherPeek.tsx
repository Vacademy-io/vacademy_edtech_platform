import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { chatbotAPI, type ChatPeek } from "@/services/chatbot-api";
import { useChatbotContext } from "./useChatbotContext";
import { AssistantAvatar } from "./MessageBubble";

/** Wait this long after the page settles before asking for a peek. */
const PEEK_DELAY_MS = 2500;
/** The peek hides itself after this long. */
const PEEK_VISIBLE_MS = 9000;

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
};

const peekKey = async (): Promise<string | null> => {
  try {
    const { userId, instituteId } = await chatbotAPI.getScope();
    return userId ? `chatbot:peek-shown:${userId}:${instituteId}` : null;
  } catch {
    return null;
  }
};

const shownToday = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === today();
  } catch {
    return false;
  }
};

const markShown = (key: string): void => {
  try {
    localStorage.setItem(key, today());
  } catch {
    // Storage blocked: the peek may show again today, which is harmless.
  }
};

/**
 * A small speech bubble beside the closed launcher with a timely nudge from
 * the starters endpoint ("Your live class starts in 10 min — want a recap?").
 * At most once a day per learner; hides after a few seconds; tap opens the
 * chat and asks it, × dismisses.
 */
export const LauncherPeek: React.FC<{
  /** The launcher is on screen and idle (chat closed, no call, not dragging). */
  enabled: boolean;
  /** Align the bubble to the launcher's end edge (default corner) or start edge. */
  alignEnd: boolean;
  /** The bubble sits below the launcher (launcher parked near the top). */
  below?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}> = ({ enabled, alignEnd, below = false, onVisibleChange }) => {
  const { t } = useTranslation("chatFeatureB");
  const reduceMotion = useReducedMotion();
  const { loadStarters, openAndSend, chatbotSettings } = useChatbotContext();
  const [peek, setPeek] = useState<ChatPeek | null>(null);
  /** One attempt per app load: the endpoint is not asked again on every page. */
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!enabled || attemptedRef.current) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      attemptedRef.current = true;
      const key = await peekKey();
      const data = key && !shownToday(key) ? await loadStarters() : null;
      if (cancelled) {
        // Interrupted (navigated, opened the chat): a later idle moment may try again.
        attemptedRef.current = false;
        return;
      }
      if (!key || !data?.peek) return;
      markShown(key);
      setPeek(data.peek);
    }, PEEK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, loadStarters]);

  // Auto-hide, and hide for good once the launcher is busy or gone.
  useEffect(() => {
    if (!peek) return;
    if (!enabled) {
      setPeek(null);
      return;
    }
    const timer = setTimeout(() => setPeek(null), PEEK_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [peek, enabled]);

  const visible = !!peek && enabled;
  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);

  return (
    <AnimatePresence>
      {visible && peek && (
        <motion.div
          key="peek"
          role="status"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: below ? -10 : 10, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: below ? -6 : 6, scale: 0.96 }}
          transition={reduceMotion ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 28 }}
          className={cn(
            "pointer-events-auto relative flex w-max max-w-64 items-start gap-2 rounded-2xl bg-card py-2.5 ps-2.5 pe-1.5 text-card-foreground shadow-xl ring-1 ring-primary/20",
            below
              ? alignEnd
                ? "ltr:origin-top-right rtl:origin-top-left"
                : "ltr:origin-top-left rtl:origin-top-right"
              : alignEnd
                ? "ltr:origin-bottom-right rtl:origin-bottom-left"
                : "ltr:origin-bottom-left rtl:origin-bottom-right",
          )}
        >
          <button
            type="button"
            onClick={() => {
              setPeek(null);
              openAndSend(peek.prompt);
            }}
            className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AssistantAvatar className="h-7 w-7" />
            <span className="min-w-0 flex-1">
              <span className="block text-caption font-semibold text-primary">
                {chatbotSettings.assistant_name}
              </span>
              <span className="block text-sm leading-snug text-foreground">{peek.text}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPeek(null)}
            aria-label={t("peek.dismiss")}
            title={t("peek.dismiss")}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
          {/* The bubble's tail, pointing at the launcher. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute size-3 rotate-45 bg-card",
              below ? "-top-1.5" : "-bottom-1.5",
              alignEnd ? "end-6" : "start-6",
            )}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
