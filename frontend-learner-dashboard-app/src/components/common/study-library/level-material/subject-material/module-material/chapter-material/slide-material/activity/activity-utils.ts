import type { EngagementFlashcardsPayload } from "@/services/engagement";

/**
 * Flashcards, Poll and Game slides: DOCUMENT slides whose published_data is JSON.
 * Pure (no React, type-only app imports) so it can be tested in isolation.
 *
 * - FLASHCARDS: the `flashcards/v1` payload of a daily-engagement Flashcards task.
 * - POLL: `{question, options: [{id, text}], settings: {results, allowChange}}`.
 * - GAME: `{html, maxScore, instructions}`.
 */
export const ACTIVITY_DOC_TYPES = new Set(["FLASHCARDS", "POLL", "GAME"]);

/**
 * The deck, read as the daily-task runner reads it (services/engagement parseFlashcards):
 * cards missing an id, a front or a back are skipped; null = nothing to study.
 */
export function parseFlashcardsSlide(json: string | null | undefined): EngagementFlashcardsPayload | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { cards?: unknown; settings?: { shuffle?: unknown } | null } | null;
    if (!raw || !Array.isArray(raw.cards)) return null;
    const cards: EngagementFlashcardsPayload["cards"] = [];
    for (const c of raw.cards as Array<Record<string, unknown> | null>) {
      if (!c) continue;
      const { id, front, back, hint } = c;
      if (typeof id !== "string" || !id) continue;
      if (typeof front !== "string" || !front.trim()) continue;
      if (typeof back !== "string" || !back.trim()) continue;
      cards.push({ id, front, back, ...(typeof hint === "string" && hint.trim() ? { hint } : {}) });
    }
    if (cards.length === 0) return null;
    return { schema: "flashcards/v1", cards, shuffle: raw.settings?.shuffle !== false };
  } catch {
    return null;
  }
}

export interface PollSlideSpec {
  question: string;
  options: { id: string; text: string }[];
}

export function parsePollSlide(json: string | null | undefined): PollSlideSpec | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { question?: unknown; options?: unknown } | null;
    if (!raw || !Array.isArray(raw.options)) return null;
    const options = (raw.options as Array<Record<string, unknown> | null>)
      .filter((o): o is Record<string, unknown> => !!o)
      .filter((o) => typeof o.id === "string" && o.id && typeof o.text === "string" && o.text.trim())
      .map((o) => ({ id: o.id as string, text: (o.text as string).trim() }));
    if (options.length < 2) return null;
    return { question: typeof raw.question === "string" ? raw.question : "", options };
  } catch {
    return null;
  }
}

export interface GameSlideSpec {
  html: string;
  maxScore: number | null;
  instructions: string;
}

export function parseGameSlide(json: string | null | undefined): GameSlideSpec | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { html?: unknown; maxScore?: unknown; instructions?: unknown } | null;
    if (!raw || typeof raw.html !== "string" || !raw.html.trim()) return null;
    const max = Number(raw.maxScore);
    return {
      html: raw.html,
      maxScore: Number.isFinite(max) && max > 0 ? max : null,
      instructions: typeof raw.instructions === "string" ? raw.instructions : "",
    };
  } catch {
    return null;
  }
}

/**
 * Whether a game page can ever report a result. Only a page that posts
 * `vacademy:complete` does; the admin game editor warns the teacher by the same rule.
 */
export function gameReportsResult(html: string): boolean {
  return html.includes("vacademy:complete");
}

/** Plain text for the AI tutor: the cards, the poll question, or the game's instructions. */
export function activityTutorText(type: string, json: string | null | undefined): string {
  if (type === "FLASHCARDS") {
    const deck = parseFlashcardsSlide(json);
    return deck ? deck.cards.map((c) => `${c.front} — ${c.back}`).join("\n").slice(0, 8000) : "";
  }
  if (type === "POLL") {
    const poll = parsePollSlide(json);
    return poll ? `${poll.question}\n${poll.options.map((o) => `- ${o.text}`).join("\n")}` : "";
  }
  if (type === "GAME") return parseGameSlide(json)?.instructions ?? "";
  return "";
}

/** Share of the votes, rounded; 0 when nobody voted. */
export function votePercent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}
