/**
 * Course badges, computed from live LMS data:
 *
 *   Bestseller — top N paid courses by enrolments, institute-wide (default 3)
 *   Popular    — the most-enrolled course in each stream (a stream = a course tag)
 *   New        — published in the last N days (default 60)
 *   Free       — costs nothing
 *
 * Enrolments arrive as a RANK from the public popularity endpoint, never as a
 * raw count, so a visitor can see "Bestseller" without the institute exposing
 * how many people bought what.
 */

export type CourseBadge = "bestseller" | "popular" | "new" | "free";

export const ALL_BADGES: CourseBadge[] = ["bestseller", "popular", "new", "free"];

export interface BadgeRules {
  enabled?: boolean;
  /** Which badges may show, in priority order. */
  types?: CourseBadge[];
  /** "New" window in days. */
  newDays?: number;
  /** How many paid courses count as bestsellers. */
  bestsellerTop?: number;
  /** At most this many badges on one card. */
  max?: number;
}

export interface BadgeInput {
  /** package_id */
  courseId: string;
  /** ISO timestamp the course was published/created. */
  createdAt?: string | null;
  /** Lowest price of the course (across its versions); 0 = free. */
  price?: number | null;
  /** Course tags (comma-separated tags already split). */
  tags?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Badges per course id, in the configured priority order and capped at
 * `rules.max`. `ranks` maps course id → rank (1 = most enrolled); courses with
 * no enrolments are simply absent. `now` is passed in so results are testable.
 */
export const computeCourseBadges = (
  courses: BadgeInput[],
  opts: { ranks: Map<string, number>; streamTags?: string[]; now: number; rules?: BadgeRules },
): Map<string, CourseBadge[]> => {
  const rules = opts.rules || {};
  const types = (rules.types?.length ? rules.types : ALL_BADGES).filter((t) => ALL_BADGES.includes(t));
  const newDays = rules.newDays && rules.newDays > 0 ? rules.newDays : 60;
  const top = rules.bestsellerTop && rules.bestsellerTop > 0 ? rules.bestsellerTop : 3;
  const max = rules.max && rules.max > 0 ? rules.max : 2;
  const rankOf = (id: string) => opts.ranks.get(id);
  const isPaid = (c: BadgeInput) => typeof c.price === "number" && c.price > 0;

  const earned = new Map<string, Set<CourseBadge>>();
  const give = (id: string, badge: CourseBadge) => {
    if (!earned.has(id)) earned.set(id, new Set());
    earned.get(id)!.add(badge);
  };

  // Bestseller: the top N PAID courses by rank.
  courses
    .filter((c) => isPaid(c) && rankOf(c.courseId) !== undefined)
    .sort((a, b) => rankOf(a.courseId)! - rankOf(b.courseId)!)
    .slice(0, top)
    .forEach((c) => give(c.courseId, "bestseller"));

  // Popular: the best-ranked course of each stream.
  for (const stream of opts.streamTags || []) {
    const s = stream.trim().toLowerCase();
    if (!s) continue;
    let best: BadgeInput | null = null;
    for (const c of courses) {
      const r = rankOf(c.courseId);
      if (r === undefined) continue;
      if (!(c.tags || []).some((t) => t.trim().toLowerCase() === s)) continue;
      if (!best || r < rankOf(best.courseId)!) best = c;
    }
    if (best) give(best.courseId, "popular");
  }

  for (const c of courses) {
    if (c.createdAt) {
      const t = Date.parse(c.createdAt);
      if (!Number.isNaN(t) && opts.now - t >= 0 && opts.now - t <= newDays * DAY_MS) give(c.courseId, "new");
    }
    if (c.price === 0) give(c.courseId, "free");
  }

  const out = new Map<string, CourseBadge[]>();
  for (const c of courses) {
    const set = earned.get(c.courseId);
    if (!set) continue;
    const list = types.filter((t) => set.has(t)).slice(0, max);
    if (list.length) out.set(c.courseId, list);
  }
  return out;
};

/** Sort comparator for "Popular": ranked courses first by rank, then the rest in their existing order. */
export const comparePopularity = (ranks: Map<string, number>) => (a: string, b: string): number => {
  const ra = ranks.get(a);
  const rb = ranks.get(b);
  if (ra === undefined && rb === undefined) return 0;
  if (ra === undefined) return 1;
  if (rb === undefined) return -1;
  return ra - rb;
};
