import { useContext } from "react";
import type { TFunction } from "i18next";
import { ChatbotContext, type ChatbotContextType } from "../ChatbotContextType";

/**
 * Shared plumbing for the tutor's entry points inside learning moments
 * (select-to-ask, "Why was I wrong?", the video "stuck" chip, the Today buddy
 * line). Every prompt here is a complete, localized request that is sent as
 * the learner's own message through `openAndSend`.
 */

/** Selections shorter than this are taps or stray words, not a question. */
export const SELECTION_MIN_CHARS = 12;
/** The quoted selection is trimmed to about this many characters. */
export const SELECTION_MAX_CHARS = 600;

/**
 * The chatbot context, or undefined when no ChatbotProvider is mounted (tests,
 * isolated previews). Entry points render nothing without it.
 */
export function useOptionalChatbot(): ChatbotContextType | undefined {
  return useContext(ChatbotContext);
}

/**
 * The chatbot when a moment may offer it right now: provider mounted, chatbot
 * enabled, visible on this route (which already excludes `/assessment/**`, so
 * never during a live test), and no voice call in progress.
 */
export function useAvailableTutor(): ChatbotContextType | null {
  const ctx = useOptionalChatbot();
  if (!ctx || ctx.voiceMode || !ctx.shouldShowChatbot()) return null;
  return ctx;
}

/** Collapse whitespace and trim to `max` characters (ending with "…" when cut). */
export function clipText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

export type SelectionAction = "explain" | "simplify" | "quiz";

/** "Explain this from my lesson "Cells": “…”" (or without the lesson name). */
export function selectionPrompt(
  t: TFunction,
  action: SelectionAction,
  selection: string,
  lessonName?: string | null,
): string {
  const text = clipText(selection, SELECTION_MAX_CHARS);
  const lesson = lessonName?.trim();
  return lesson
    ? t(`moments.selection.prompt.${action}InLesson`, { text, lesson })
    : t(`moments.selection.prompt.${action}`, { text });
}

/** What the learner can already see about a question they got wrong. */
export interface WrongAnswerDetails {
  question: string;
  yourAnswer: string;
  correctAnswer: string;
  explanation?: string | null;
  /** Where it came from: a quiz or lesson title, "Question of the day"… */
  source?: string | null;
}

/** The "Why was I wrong?" request: the question, both answers, and what to do. */
export function whyWrongPrompt(t: TFunction, details: WrongAnswerDetails): string {
  const source = details.source?.trim();
  const lines = [
    source ? t("moments.whyWrong.prompt.introFrom", { source }) : t("moments.whyWrong.prompt.intro"),
    t("moments.whyWrong.prompt.question", { text: clipText(details.question, 900) }),
    t("moments.whyWrong.prompt.yours", { text: clipText(details.yourAnswer, 300) }),
    t("moments.whyWrong.prompt.correct", { text: clipText(details.correctAnswer, 300) }),
  ];
  const explanation = details.explanation?.trim();
  if (explanation) {
    lines.push(t("moments.whyWrong.prompt.explanation", { text: clipText(explanation, 600) }));
  }
  lines.push(t("moments.whyWrong.prompt.ask"));
  return lines.join("\n");
}

/** Seconds → "03:12" / "1:03:12", as the players show it. */
export function formatVideoTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
}

/**
 * Visible text of one marked part of a review card, for answers whose markup
 * is produced by a renderer (options, numbers, matrices…). The card carries
 * `data-why-wrong-scope`; its parts carry `data-why-wrong="yours" | "correct"`.
 */
export function readWhyWrongPart(from: HTMLElement, part: "yours" | "correct"): string {
  const scope = from.closest<HTMLElement>("[data-why-wrong-scope]");
  const el = scope?.querySelector<HTMLElement>(`[data-why-wrong="${part}"]`);
  return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
}
