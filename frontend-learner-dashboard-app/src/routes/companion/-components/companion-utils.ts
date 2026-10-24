import type {
  CompanionApiError,
  CompanionLeaf,
  CompanionTopic,
  LeafProgress,
} from "@/services/kb-companion-api";

/** React-query keys for the companion surfaces. */
export const companionKeys = {
  list: ["kb-companions"] as const,
  detail: (id: string) => ["kb-companion", id] as const,
  thread: (id: string) => ["kb-companion-thread", id] as const,
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The companion's own colour (admin-picked, per companion). Only a plain hex is
 * trusted; anything else falls back to the institute's primary tokens.
 */
export function accentOf(value?: string | null): string | null {
  if (!value || !HEX.test(value.trim())) return null;
  const v = value.trim();
  if (v.length === 4) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return v.toLowerCase();
}

/** 8-digit hex = the accent at a given alpha (00-ff), for soft washes. */
export function accentAlpha(accent: string, alpha: string): string {
  return `${accent}${alpha}`;
}

export function flattenLeaves(topics: CompanionTopic[]): CompanionLeaf[] {
  return topics.flatMap((t) => t.leaves);
}

export function findLeaf(topics: CompanionTopic[], leafId: string | null | undefined) {
  if (!leafId) return null;
  for (const topic of topics) {
    const leaf = topic.leaves.find((l) => l.id === leafId);
    if (leaf) return { topic, leaf };
  }
  return null;
}

/** The leaf after `leafId` in map order (null at the end of the map). */
export function nextLeafAfter(topics: CompanionTopic[], leafId: string): CompanionLeaf | null {
  const all = flattenLeaves(topics);
  const i = all.findIndex((l) => l.id === leafId);
  return i >= 0 && i + 1 < all.length ? all[i + 1] : null;
}

/** How far through a leaf's lesson the learner is, 0-100. */
export function leafPercent(progress: LeafProgress | null | undefined): number {
  if (!progress) return 0;
  if (progress.status === "COMPLETED") return 100;
  const total = progress.cards_total || 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(99, Math.round(((progress.card_index + 1) / total) * 100)));
}

export type MasteryTone = "none" | "low" | "mid" | "high";

export function masteryTone(mastery: number | null | undefined): MasteryTone {
  if (mastery == null || mastery <= 0) return "none";
  if (mastery >= 80) return "high";
  if (mastery >= 50) return "mid";
  return "low";
}

/** BCP-47 voice tag for the browser speech fallback. */
export function speechLangFor(language: string | null | undefined): string {
  if (language === "hi") return "hi-IN";
  if (language === "kn") return "kn-IN";
  return "en-IN";
}

/** Fisher-Yates; returns a new array. */
export function shuffled<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Friendly message for any companion API failure (402 credits, FAILED compile…). */
export function companionErrorText(
  t: (key: string) => string,
  error: CompanionApiError | null,
  fallbackKey = "errors.generic",
): string {
  if (!error) return t(fallbackKey);
  if (error.status === 402) return error.message || t("errors.credits");
  if (error.status === 403) return error.message || t("errors.forbidden");
  if (error.status === 404) return t("errors.notFound");
  return error.message || t(fallbackKey);
}
