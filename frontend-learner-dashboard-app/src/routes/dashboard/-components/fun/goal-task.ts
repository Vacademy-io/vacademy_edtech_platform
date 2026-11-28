import type { EngagementFeed, EngagementItem } from "@/services/engagement";
import { buildTodayView } from "../engagement/TodayModule";

export interface GoalTask {
  item: EngagementItem;
  /** The order the runner's "Next" walks, as the Today module gives it. */
  queue: string[];
}

/**
 * The task the Fun goal card opens: the Today module's own "Up next" (the first open
 * must-do, else the first open task), else the oldest catch-up still open. Null when
 * nothing is open (the card then opens the plan's page).
 */
export function goalTaskOf(feed: EngagementFeed | null | undefined): GoalTask | null {
  if (!feed) return null;
  const view = buildTodayView(feed, null, 0);
  const item = view.upNext ?? view.catchUp[0] ?? null;
  if (!item) return null;
  return { item, queue: view.queue.includes(item.id) ? view.queue : [item.id, ...view.queue] };
}
