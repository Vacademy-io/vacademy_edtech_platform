import { formatDateTime, formatRelative } from "@/lib/formatters";
import type { DiscussionReaction } from "./discussion-api";

/**
 * The teacher's question from the slide's document JSON
 * (`{version, prompt_html, settings}`). Only the question is read from here:
 * what the learner may do always comes from the server's thread response.
 */
export function readDiscussionPrompt(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json) as { prompt_html?: unknown };
    return typeof parsed?.prompt_html === "string" ? parsed.prompt_html : "";
  } catch {
    return "";
  }
}

/** Supportive reactions only, in the order the teacher's editor lists them. */
export const DISCUSSION_REACTIONS: Record<DiscussionReaction, { emoji: string }> = {
  HEART: { emoji: "❤️" },
  HUG: { emoji: "🤗" },
  THANKS: { emoji: "🙏" },
  INSIGHT: { emoji: "💡" },
  RELATE: { emoji: "🤝" },
  STRENGTH: { emoji: "💪" },
};

export const isKnownReaction = (value: string): value is DiscussionReaction =>
  Object.prototype.hasOwnProperty.call(DISCUSSION_REACTIONS, value);

const toTime = (value: string | number | undefined | null): number => {
  if (value === undefined || value === null || value === "") return NaN;
  return new Date(value).getTime();
};

/** "just now" under a minute, then the locale's relative time ("3 hours ago"). */
export function postTimeLabel(
  value: string | number | undefined,
  justNow: string
): string {
  const time = toTime(value);
  if (Number.isNaN(time)) return "";
  if (Math.abs(Date.now() - time) < 60_000) return justNow;
  return formatRelative(time);
}

/** Full date and time, for the tooltip on a relative time. */
export function postTimeTitle(value: string | number | undefined): string {
  const time = toTime(value);
  return Number.isNaN(time) ? "" : formatDateTime(time);
}

/** Up to two initials from a display name, for the avatar. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}
