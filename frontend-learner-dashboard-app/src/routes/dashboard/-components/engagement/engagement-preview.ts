import DOMPurify from "dompurify";
import type { TFunction } from "i18next";

/**
 * Short previews ("glimpses") of a task, shown before it is opened.
 *
 * The server may send a ready-made `excerpt` (160 chars) and `promptText`
 * (D46); older servers send only `contentHtml` / `payloadJson`, so every
 * helper here prefers the server field and falls back to deriving it.
 */

/** The fields the preview helpers read. Every EngagementItem satisfies this. */
export interface EngagementPreviewItem {
  itemType: string;
  title?: string | null;
  contentHtml?: string | null;
  payloadJson?: string | null;
  maxScore?: number | null;
  /** Server-side plain-text excerpt of the content (new servers). */
  excerpt?: string | null;
  /** Server-side plain-text question prompt (new servers). */
  promptText?: string | null;
  /** Server reading gate, in ms (new servers). */
  minReadMs?: number | null;
}

/** Reading speed used for "Read · N min". */
const WORDS_PER_MINUTE = 200;
/** Seconds a learner spends per flashcard, on average (flashcards spec B2). */
const SECONDS_PER_CARD = 12;

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sameText(a: string, b: string): boolean {
  return normalise(a).toLocaleLowerCase() === normalise(b).toLocaleLowerCase();
}

/** Cut on a word boundary so a glimpse never ends mid-word. */
export function clampText(text: string, max = 160): string {
  const clean = normalise(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** Drop a leading copy of the title from plain text ("Photosynthesis Photosynthesis is…"). */
export function dropLeadingTitle(text: string, title?: string | null): string {
  const clean = normalise(text);
  const heading = title ? normalise(title) : "";
  if (!heading) return clean;
  if (!clean.toLocaleLowerCase().startsWith(heading.toLocaleLowerCase())) return clean;
  const rest = clean.slice(heading.length);
  // Only a whole-word match counts: title "Photo" must not eat "Photosynthesis".
  if (rest && /^[\p{L}\p{N}]/u.test(rest)) return clean;
  return rest.replace(/^[\s:.\-–—]+/, "");
}

/** Sanitised plain text of authored HTML; "" when there is no DOM or no content. */
function htmlToText(html: string, dropTitle?: string | null): string {
  if (typeof document === "undefined") return "";
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  const holder = document.createElement("div");
  holder.innerHTML = clean;
  if (dropTitle) {
    // The reading often opens with an <h1> that repeats the task title.
    // Only a LEADING heading: a later section heading that happens to match stays.
    const first = holder.querySelector("h1, h2, h3");
    const heading = first?.textContent ?? "";
    const leads = normalise(holder.textContent ?? "")
      .toLocaleLowerCase()
      .startsWith(normalise(heading).toLocaleLowerCase());
    if (first && heading && leads && sameText(heading, dropTitle)) first.remove();
  }
  return normalise(holder.textContent ?? "");
}

/**
 * Turn a task's authored HTML into a short plain-text glimpse.
 *
 * Sanitize first, then read textContent: parsing raw HTML into a detached element
 * without sanitizing would still run `onerror` handlers on any injected markup.
 */
export function excerptFromHtml(
  html: string | null | undefined,
  max = 160,
  options: { dropTitle?: string | null } = {}
): string {
  if (!html) return "";
  try {
    return clampText(htmlToText(html, options.dropTitle), max);
  } catch {
    return "";
  }
}

/** Word count of the task's HTML; 0 when there is no content to count. */
function wordCount(html: string | null | undefined): number {
  if (!html) return 0;
  try {
    const text = htmlToText(html);
    return text ? text.split(" ").length : 0;
  } catch {
    return 0;
  }
}

/** Plain text of a question prompt from the server field or the payload. */
export function promptTextFor(item: EngagementPreviewItem): string {
  if (item.promptText) return normalise(item.promptText);
  if (!item.payloadJson) return "";
  try {
    const prompt = (JSON.parse(item.payloadJson) as { prompt?: unknown } | null)?.prompt;
    if (typeof prompt !== "string" || !prompt) return "";
    // Prompts are authored rich text; fall back to a tag strip without a DOM.
    const text = htmlToText(prompt);
    return text || normalise(prompt.replace(/<[^>]*>/g, " "));
  } catch {
    return "";
  }
}

/** How a question of the day is answered; older items carry no format. */
function formatOf(item: EngagementPreviewItem): "MCQ" | "TEXT" | "UPLOAD" {
  if (!item.payloadJson) return "MCQ";
  try {
    const format = (JSON.parse(item.payloadJson) as { format?: string } | null)?.format;
    return format === "TEXT" || format === "UPLOAD" ? format : "MCQ";
  } catch {
    return "MCQ";
  }
}

/** Minutes a deck takes: max(1, ceil(n × 12 s / 60)). Shared with the admin helper. */
export function estimateFlashcardMinutes(cardCount: number): number {
  const n = Number.isFinite(cardCount) ? Math.max(0, Math.floor(cardCount)) : 0;
  return Math.max(1, Math.ceil((n * SECONDS_PER_CARD) / 60));
}

/**
 * Card count of a FLASHCARDS item. The server sends `maxScore = cards.size()`
 * in every state, including UPCOMING; the payload is the fallback.
 */
export function flashcardCount(item: EngagementPreviewItem): number {
  if (typeof item.maxScore === "number" && item.maxScore > 0) return item.maxScore;
  if (!item.payloadJson) return 0;
  try {
    const cards = (JSON.parse(item.payloadJson) as { cards?: unknown } | null)?.cards;
    return Array.isArray(cards) ? cards.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Estimated reading minutes, or null when there is nothing to estimate from.
 * Uses the content's word count; falls back to the server's reading gate.
 */
export function estimateReadMinutes(item: EngagementPreviewItem): number | null {
  if (item.itemType !== "READING_HTML" && item.itemType !== "VISUAL_NOTE") return null;
  const words = wordCount(item.contentHtml);
  if (words > 0) return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  if (typeof item.minReadMs === "number" && item.minReadMs > 0) {
    return Math.max(1, Math.ceil(item.minReadMs / 60000));
  }
  return null;
}

/**
 * The glimpse a task shows before it is opened (D39):
 * - reading / visual note: the text, without a leading heading that repeats the title;
 * - written or uploaded question: the prompt;
 * - flashcards: "12 cards · ~3 min" (needs `t`, bound to `dashboardEngagement`);
 * - multiple choice, poll: none. Their prompt is drawn with the options (the
 *   legacy card's InlineQuestion, later ChoiceOptions), so a glimpse would
 *   print it twice; use `promptTextFor` where the prompt stands alone;
 * - game, lesson, quiz: no glimpse.
 */
export function glimpseFor(item: EngagementPreviewItem, t?: TFunction): string {
  switch (item.itemType) {
    case "GAME":
    case "COURSE_SLIDE":
    case "QUIZ":
      return "";
    case "FLASHCARDS": {
      if (!t) return "";
      const count = flashcardCount(item);
      if (count <= 0) return "";
      return t("preview.flashcards", {
        count,
        minutes: estimateFlashcardMinutes(count),
      });
    }
    case "QUESTION_OF_DAY":
      return isOpenAnswerQuestion(item) ? clampText(promptTextFor(item), 160) : "";
    case "POLL":
      return "";
    case "READING_HTML":
    case "VISUAL_NOTE":
    default: {
      if (item.excerpt) return clampText(dropLeadingTitle(item.excerpt, item.title), 160);
      return excerptFromHtml(item.contentHtml, 160, { dropTitle: item.title });
    }
  }
}

/** True for a question answered in writing or with a file, whose glimpse is its prompt. */
export function isOpenAnswerQuestion(item: EngagementPreviewItem): boolean {
  return item.itemType === "QUESTION_OF_DAY" && formatOf(item) !== "MCQ";
}
