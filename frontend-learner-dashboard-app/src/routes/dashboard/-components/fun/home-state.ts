/**
 * What the Fun home shows, decided from answers the dashboard already has.
 * Pure: no React, no DOM, no requests. Every rule here reuses a shared fact
 * (learnerHasStarted, the resume check, the enrolment standing, hide-progress)
 * instead of working one out again.
 */
import type { EnrolledCourse } from "@/services/enrolled-courses";
import { everythingFinished, type EnrolledStanding } from "@/lib/learner-state/course-progress";
import { looksLikeName } from "@/lib/learner-state/display-name";
import type { BatchNames } from "@/components/design-system/fun/batch-names";
import { distinctPartsFirst } from "@/components/design-system/fun/distinct-first";

/**
 * The hero card:
 * - resume: a checked lesson to pick up (A-Main);
 * - skeleton: the resume answer or the first-run question is still out (at most 3 s);
 * - error: the dashboard request failed and there is nothing to resume;
 * - noCourses: the learner has no course here (A-Empty);
 * - done: every course is finished and nothing is listed in progress (A-Done);
 * - caughtUp: progress, nothing in progress, not all finished (A-Done's card, other words);
 * - start: a new learner with a course not started yet (A-New);
 * - courses: progress, but no lesson could be offered: a way to the course list.
 */
export type FunHeroKind = "resume" | "skeleton" | "error" | "noCourses" | "done" | "caughtUp" | "start" | "courses";

export interface FunHeroInput {
  hasResume: boolean;
  resumeResolving: boolean;
  /** The page has settled whether the learner has started (the hero's first-run question). */
  firstRunKnown: boolean;
  hasAnyProgress: boolean;
  /** The dashboard request is still out. */
  dashboardLoading: boolean;
  /** The dashboard request answered (false after it failed). */
  dashboardAnswered: boolean;
  /** The dashboard lists a lesson in progress (the Continue Learning rows). */
  lessonsListed: boolean;
  standing: EnrolledStanding;
  /** The enrolled list for this page: null while it is out, or when it could not be read. */
  courses: readonly EnrolledCourse[] | null;
  /** The enrolled list is still out (and has not waited too long). */
  coursesPending: boolean;
  hideProgress: boolean | null;
}

export function funHeroKind(input: FunHeroInput): FunHeroKind {
  if (input.hasResume) return "resume";
  if (input.resumeResolving || !input.firstRunKnown || input.dashboardLoading) return "skeleton";
  if (!input.dashboardAnswered) return "error";
  const noCourses = input.standing === "noCourses" || (input.courses !== null && input.courses.length === 0);
  if (noCourses) return "noCourses";
  if (
    everythingFinished({
      hasResume: false,
      resumeResolving: false,
      firstRunKnown: true,
      standing: input.standing,
      lessonsListed: input.lessonsListed,
      hideProgress: input.hideProgress,
    })
  ) {
    return "done";
  }
  if (input.hasAnyProgress) return input.lessonsListed ? "courses" : "caughtUp";
  if (startCourseOf(input.courses)) return "start";
  if (input.coursesPending) return "skeleton";
  return "courses";
}

/**
 * The course a new learner is offered: the first not-started course in the enrolled
 * list's own order (A to Z among the not started).
 */
export function startCourseOf(courses: readonly EnrolledCourse[] | null | undefined): EnrolledCourse | null {
  return courses?.find((course) => course.state === "NOT_STARTED") ?? null;
}

/** "Start Chemistry" reads well; past this length the name stays on the card title and the button says "Start" with the course term. */
export const START_NAME_MAX = 16;

/** The name the header uses, or "" when it would read as a phone number, an email or a code. */
export function headerFirstName(firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim();
  if (!looksLikeName(name)) return "";
  return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
}

/** Initials for the avatar button: first and last word of the full name. */
export function initialsOf(fullName: string | null | undefined): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = Array.from(words[0]!)[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/**
 * How many lessons the folded Continue Learning row stands for: the listed lessons
 * other than the one the hero offers. A hero lesson that is not listed (resumed from
 * this device) takes nothing off the count.
 */
export function foldCount(listedSlideIds: readonly string[], heroSlideId: string | null | undefined): number {
  return listedSlideIds.filter((id) => id !== heroSlideId).length;
}

export type TodayCardId = "goal" | "class" | "tests";

/**
 * The goal card while a teacher's plan runs today (it is the home's one way into the
 * plan's tasks, so it shows whenever the plan does):
 * - ring: "N of M tasks today" with the ring;
 * - next: the next task's name, with no count, where the institute hides progress
 *   (the ring is progress) or has gamification off (no ring);
 * - null: no plan today, the todayTasks widget is off, or hide-progress is still
 *   being read.
 */
export type GoalCardKind = "ring" | "next";
export function goalCardKind(input: {
  planRunning: boolean;
  showGoal: boolean;
  hideProgress: boolean | null;
  showRing: boolean;
}): GoalCardKind | null {
  if (!input.showGoal || !input.planRunning || input.hideProgress === null) return null;
  return input.hideProgress || !input.showRing ? "next" : "ring";
}

/**
 * The Today cards in the boards' order: goal, class, tests (A-New, A-Laptop).
 *
 * Saved widget orders only sort widgets within one column (student-defaults.ts).
 * The class card stands for a rail widget (upcomingLiveClasses) and the tests card for
 * a main-column one (evaluationStat), so those two are never compared: class comes
 * before tests. The goal card stands for todayTasks, which sits in either column, so
 * it moves behind every card whose widget the institute saved before it.
 */
export function orderTodayCards(
  cards: readonly { id: TodayCardId; order: number }[],
): TodayCardId[] {
  const fixed = (["class", "tests"] as const).filter((id) => cards.some((card) => card.id === id));
  const goal = cards.find((card) => card.id === "goal");
  if (!goal) return [...fixed];
  const before = fixed.filter((id) => (cards.find((card) => card.id === id)?.order ?? 0) < goal.order).length;
  return [...fixed.slice(0, before), "goal", ...fixed.slice(before)];
}

/** How many course tiles show before "See all": every one when the institute asks for all. */
export const MAX_HOME_TILES = 4;
export function visibleTiles<T>(courses: readonly T[], showAll: boolean, max = MAX_HOME_TILES): T[] {
  return showAll ? [...courses] : courses.slice(0, max);
}

export type TilesMode = "all" | "others" | "lookBack";

/**
 * A course at 100% that still has a lesson listed in progress on the dashboard: its
 * tile shows the nearly-done percent the hero uses, never the finished tick, so the
 * page does not say both "nearly there" and "Review" about it.
 */
export function nearlyDone(course: EnrolledCourse, listedCourseIds: ReadonlySet<string>): boolean {
  return course.state === "COMPLETED" && listedCourseIds.has(course.id);
}

/**
 * Whether a tile reads "Not started": the course is at 0% and nothing says the
 * learner opened it (no lesson of it listed in progress on the dashboard, no resume
 * entry for it on this device). A course the hero offers to continue at 0% then
 * shows its 0% bar, never "Not started" under that Continue.
 */
export function tileNotStarted(course: EnrolledCourse, listedCourseIds: ReadonlySet<string>, resumedHere: boolean): boolean {
  return course.state === "NOT_STARTED" && !listedCourseIds.has(course.id) && !resumedHere;
}

/**
 * Which tiles the home shows. Every course finished and no lesson still listed in
 * progress: a small "Look back" row (A-Done). The hero offers a course to start
 * (`heroOffersStart`, A-New): the courses after that one, so the page never names
 * it twice; with a single course the hero is the whole list, so no tiles show.
 * Otherwise every course (A-Main), in the enrolled list's own order, so a learner
 * who has started (even with every course still reading 0%) sees each course once,
 * whatever the hero offers. With every course at 100% but a lesson still listed,
 * the hero says "Nearly there", so the tiles do not look back either. When the
 * institute hides progress (`hideProgress`), nothing on the home signals
 * completion, so the tiles do not look back.
 */
export function tilesModeOf(
  courses: readonly EnrolledCourse[],
  lessonsListed = false,
  hideProgress = false,
  heroOffersStart = false,
): TilesMode {
  if (!hideProgress && !lessonsListed && courses.length > 0 && courses.every((c) => c.state === "COMPLETED")) return "lookBack";
  if (heroOffersStart && startCourseOf(courses)) return "others";
  return "all";
}

/**
 * Whether the hero offers a course to start, for the tiles: the "start" card, or its
 * skeleton while nothing says the learner has begun (a brand-new learner's tiles do
 * not reshuffle when the hero settles). Any resume or progress: false.
 */
export function heroOffersStartOf(kind: FunHeroKind, input: Pick<FunHeroInput, "hasResume" | "hasAnyProgress">): boolean {
  if (input.hasResume || input.hasAnyProgress) return false;
  return kind === "start" || kind === "skeleton";
}

/**
 * Course names that two or more of these courses share (trimmed, case folded): the
 * same course in two batches, say. Those tiles add their level and session, so two
 * "Ai/ML" tiles are not left looking identical.
 */
export function sharedCourseNames(courses: readonly Pick<EnrolledCourse, "name">[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const course of courses) {
    const key = nameKey(course.name);
    if (!key) continue;
    if (seen.has(key)) shared.add(key);
    seen.add(key);
  }
  return shared;
}

const nameKey = (name: string | null | undefined): string => (name ?? "").trim().toLocaleLowerCase();

/** A tile's names, as far as the line under its course name goes. */
export type TileNames = Pick<EnrolledCourse, "name" | "levelName" | "sessionName"> & {
  /** The batch's own name, when known ("Weekend batch"). */
  batchName?: string;
};

export interface TileSubline {
  text: string;
  /** The line tells this tile apart from another with the same name. */
  disambiguates: boolean;
}

/**
 * The line under each tile's course name: "level · session" when another tile has the
 * same name, or "level · batch" when those two still read the same; else the level
 * alone (shown only where progress is hidden). Among tiles of one name, the part that
 * differs comes first, so a phone tile that cuts the line still shows it ("2026-27 ·
 * Class 12 Science"). Placeholder names ("default") are already blank in the enrolled list.
 */
export function tileSublines<T extends TileNames>(courses: readonly T[]): Map<T, TileSubline> {
  const shared = sharedCourseNames(courses);
  const lineParts = (course: T) =>
    [course.levelName, course.sessionName ?? ""].map((part) => part.trim()).filter(Boolean);
  const sameLine = new Map<string, number>();
  for (const course of courses) {
    if (!shared.has(nameKey(course.name))) continue;
    const key = `${nameKey(course.name)}|${lineParts(course).join(" · ").toLocaleLowerCase()}`;
    sameLine.set(key, (sameLine.get(key) ?? 0) + 1);
  }
  const out = new Map<T, TileSubline>();
  const groups = new Map<string, { course: T; parts: string[] }[]>();
  for (const course of courses) {
    if (!shared.has(nameKey(course.name))) {
      out.set(course, { text: course.levelName, disambiguates: false });
      continue;
    }
    let parts = lineParts(course);
    const batch = (course.batchName ?? "").trim();
    if (batch && (sameLine.get(`${nameKey(course.name)}|${parts.join(" · ").toLocaleLowerCase()}`) ?? 0) > 1) {
      // Level and session read the same as another tile's, so the batch name tells them
      // apart. The session it shares is left out: a phone tile has room for two parts.
      const level = course.levelName.trim();
      parts = level && level.toLocaleLowerCase() !== batch.toLocaleLowerCase() ? [level, batch] : [batch];
    }
    const group = groups.get(nameKey(course.name)) ?? [];
    group.push({ course, parts });
    groups.set(nameKey(course.name), group);
  }
  for (const group of groups.values()) {
    const ordered = distinctPartsFirst(group.map((entry) => entry.parts));
    group.forEach(({ course }, index) => {
      const text = (ordered[index] ?? []).join(" · ");
      out.set(course, { text, disambiguates: text !== "" });
    });
  }
  return out;
}

/**
 * A course with the blanks in its level and session filled from its batch's names
 * (the enrolment list sends no session name), and the batch's own name.
 */
export function withTileBatchNames<T extends TileNames & { packageSessionId: string }>(
  course: T,
  names: ReadonlyMap<string, BatchNames>,
): T {
  const batch = names.get(course.packageSessionId);
  if (!batch) return course;
  return {
    ...course,
    levelName: course.levelName || batch.level,
    sessionName: course.sessionName || batch.session,
    batchName: course.batchName || batch.batch,
  };
}

/**
 * The Continue card's course bar: the rounded percent, or null to leave the bar out.
 * The handoff's rule for this card is "null hides the bar, never shows 0%", so a
 * course that still rounds to 0 draws no bar either.
 */
export function heroBarPercent(percent: number | null | undefined, hideProgress: boolean | null): number | null {
  if (hideProgress !== false || typeof percent !== "number" || !Number.isFinite(percent)) return null;
  const shown = Math.min(100, Math.round(percent));
  return shown > 0 ? shown : null;
}
