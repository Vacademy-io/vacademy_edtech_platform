/**
 * What the enrolment and resume answers already on the page say about a learner's
 * progress. Pure rules with no React and no DOM, shared by any skin that shows them.
 */

/** Slides finished out of slides visible, in the chapter the resume point sits in. */
export interface LessonCount {
  done: number;
  total: number;
  /** The subject has other chapters too, so this count is not the whole course. */
  partOfCourse: boolean;
}

/**
 * What the enrolment rows say as a whole. "noLessons" is a hint, not a fact: a few
 * real courses report no reading time (a video with no stored length), so it must
 * not tell a learner there is nothing to read.
 */
export type EnrolledStanding = "noCourses" | "noLessons" | "finished" | "unknown";

export interface EnrolmentRow {
  percentage_completed?: number | string | null;
  read_time_in_minutes?: number | null;
}

/**
 * A course's percent as its enrolment row holds it. Old rows can hold text or numbers
 * far past 100, so it is parsed and clamped; what cannot be read is null, which means
 * unknown and is not the same as nothing done.
 */
export function coursePercentOf(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

/**
 * With no resume point to name a course, the unfinished course the learner is furthest
 * along in, which is the one the course widget lists first. Null when no row can say.
 */
export function furthestUnfinishedPercent(rows: readonly EnrolmentRow[] | null | undefined): number | null {
  let furthest: number | null = null;
  for (const row of rows ?? []) {
    const percent = coursePercentOf(row.percentage_completed);
    if (percent !== null && percent < 100 && (furthest === null || percent > furthest)) furthest = percent;
  }
  return furthest;
}

/** Null rows: not answered yet. */
export function standingOf(rows: readonly EnrolmentRow[] | null | undefined): EnrolledStanding {
  if (!rows) return "unknown";
  if (rows.length === 0) return "noCourses";
  const percent = (row: EnrolmentRow) => Number(row.percentage_completed ?? 0);
  if (rows.every((row) => percent(row) >= 100)) return "finished";
  if (rows.every((row) => !(percent(row) > 0) && row.read_time_in_minutes === 0)) return "noLessons";
  return "unknown";
}

/** The most a card under a Continue button may claim: short of finished. */
export const NEARLY_DONE_PERCENT = 99;

/**
 * The course percent a home card shows. A resume point has its own course; with none,
 * the unfinished course furthest along. Every course finished while a lesson is still
 * listed in progress shows as nearly done, so the card never claims the finish above
 * a list that offers more.
 */
export function shownCoursePercent(input: {
  hasResume: boolean;
  coursePercent: number | null | undefined;
  hasAnyProgress: boolean;
  furthestPercent: number | null | undefined;
  standing: EnrolledStanding;
  lessonsListed: boolean;
}): number | null | undefined {
  if (input.hasResume) return input.coursePercent;
  if (input.standing === "finished" && input.lessonsListed) return NEARLY_DONE_PERCENT;
  return input.hasAnyProgress ? input.furthestPercent : 0;
}

/**
 * Every course is finished and nothing is left to resume or listed in progress, so a
 * home card may say so. Never where the institute hides progress.
 */
export function everythingFinished(input: {
  hasResume: boolean;
  resumeResolving: boolean;
  firstRunKnown: boolean;
  standing: EnrolledStanding;
  lessonsListed: boolean;
  /** null until read; an institute that hides progress gets no finish in words either. */
  hideProgress?: boolean | null;
}): boolean {
  return (
    input.hideProgress !== true &&
    input.standing === "finished" &&
    input.firstRunKnown &&
    !input.hasResume &&
    !input.resumeResolving &&
    !input.lessonsListed
  );
}

/**
 * Whether "n of m done in this chapter" tells a learner anything. One lesson has no
 * journey to count, and "0 of m" next to a course already partly done reads as a
 * contradiction (the bar is the course, the count only this chapter), so the line
 * waits for the chapter's first lesson done.
 */
export const countWorthShowing = (count: LessonCount | null | undefined): count is LessonCount =>
  Boolean(count) && Number(count!.total) >= 2 && Number(count!.done) >= 1;
