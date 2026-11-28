import type { CompanionSummary } from "@/services/kb-companion-api";

/**
 * The study companions on the Fun home: the same ones, in the same order, with the
 * same button words as the classic shelf (StudyCompanionsShelf), only drawn as Fun
 * tiles. Pure, so the rules can be tested without a page.
 */
export function homeCompanions(list: readonly CompanionSummary[] | null | undefined): CompanionSummary[] {
  return (list ?? []).filter((companion) => companion.show_on_dashboard);
}

export interface CompanionCta {
  /** A key in the kbCompanion namespace. */
  key: "shelf.review" | "shelf.continueTopic" | "shelf.nextTopic" | "shelf.startTopic" | "shelf.start";
  title?: string;
}

/** Every topic finished: the tile keeps its colour and adds the green tick. */
export function companionFinished(companion: Pick<CompanionSummary, "progress">): boolean {
  const total = companion.progress.leaves_total;
  return total > 0 && companion.progress.completed >= total;
}

/** The button's words, chosen exactly as the classic shelf chooses them. */
export function companionCta(companion: Pick<CompanionSummary, "progress" | "resume">): CompanionCta {
  if (companionFinished(companion)) return { key: "shelf.review" };
  const title = companion.resume?.title;
  if (!title) return { key: "shelf.start" };
  if (companion.resume?.reason === "continue") return { key: "shelf.continueTopic", title };
  return companion.progress.started > 0 ? { key: "shelf.nextTopic", title } : { key: "shelf.startTopic", title };
}
