/**
 * What the Fun home shows, decided from answers the dashboard already has.
 * Pure: no React, no DOM, no requests. Every rule here reuses a shared fact
 * (learnerHasStarted, the resume check, the enrolment standing, hide-progress)
 * instead of working one out again.
 */
import type { EnrolledCourse } from "@/services/enrolled-courses";
import { everythingFinished, type EnrolledStanding } from "@/lib/learner-state/course-progress";
import { looksLikeName } from "@/lib/learner-state/display-name";

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

/** "Start Chemistry" reads well; a long name goes on the card title and the button says the term. */
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

export type TodayCardId = "goal" | "class" | "tests";

/**
 * The Today cards in the order the institute's saved widget order gives their
 * widgets (todayTasks, upcomingLiveClasses, evaluationStat). Ties keep this order.
 */
export function orderTodayCards(
  cards: readonly { id: TodayCardId; order: number }[],
): TodayCardId[] {
  const base: TodayCardId[] = ["goal", "class", "tests"];
  return [...cards]
    .sort((a, b) => a.order - b.order || base.indexOf(a.id) - base.indexOf(b.id))
    .map((card) => card.id);
}

/** How many course tiles show before "See all": every one when the institute asks for all. */
export const MAX_HOME_TILES = 4;
export function visibleTiles<T>(courses: readonly T[], showAll: boolean, max = MAX_HOME_TILES): T[] {
  return showAll ? [...courses] : courses.slice(0, max);
}

export type TilesMode = "all" | "others" | "lookBack";

/**
 * Which tiles the home shows. Every course finished: a small "Look back" row
 * (A-Done). No course started yet: the courses after the one the hero offers
 * (A-New). Otherwise every course (A-Main), in the enrolled list's own order.
 */
export function tilesModeOf(courses: readonly EnrolledCourse[]): TilesMode {
  if (courses.length > 0 && courses.every((c) => c.state === "COMPLETED")) return "lookBack";
  if (courses.length > 1 && courses.every((c) => c.state === "NOT_STARTED")) return "others";
  return "all";
}
