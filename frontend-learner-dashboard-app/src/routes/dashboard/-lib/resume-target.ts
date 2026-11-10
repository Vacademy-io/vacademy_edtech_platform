import type { DashboardSlide } from "../-types/dashboard-data-types";
import type { ResumeEntry } from "@/services/resume-thread";
import {
  evaluateListedItem,
  type DripConditionEvaluation,
  type ListedItemDripRules,
} from "@/utils/drip-conditions";
import { calculateOverallCompletion } from "@/utils/study-library/overall-completion";
import { coursePercentOf, type LessonCount } from "@/lib/learner-state/course-progress";

/** What a dashboard hero needs to offer one lesson to pick up. */
export interface ResumeTarget {
  slideId: string;
  slideTitle: string;
  courseName?: string;
  chapterName?: string;
  /** When this device last opened it. Absent for a server-listed lesson. */
  updatedAt?: number;
  /** Finished out of visible in its chapter, from the check's own answers. */
  count?: LessonCount;
  /** The course's percent from its enrolment row, clamped. Null: the row could not be read. */
  coursePercent?: number | null;
  open: () => void;
}

/** The fields of a course, chapter tree and slide this check reads. */
export interface EnrolledCourseRow {
  id: string;
  package_session_id: string;
  package_name?: string | null;
  /** Old rows can hold text or numbers far past 100: see coursePercentOf. */
  percentage_completed?: number | string | null;
}
export interface EnrolmentResult {
  courses: EnrolledCourseRow[];
  /** False when part of the lookup failed: a course missing from a partial list may still be theirs. */
  complete: boolean;
}
export interface LiveChapter {
  chapterId: string;
  moduleId: string;
  /** False while the chapter is hidden or locked for this learner. */
  open: boolean;
  percentage?: number;
  modulePercentage?: number;
  dripCondition?: unknown;
}
export interface LiveSlide {
  id: string;
  title?: string;
  source_type?: string;
  is_hidden?: boolean | null;
  is_locked?: boolean | null;
  percentage_completed?: number | null;
  drip_condition?: unknown;
  drip_condition_json?: unknown;
}

/** The drip rules cached on this device, for one course and batch. */
export interface ResumeDripRules
  extends Omit<ListedItemDripRules, "courseCondition" | "now"> {
  /** The course-wide condition from the older row-level path, per level. */
  courseCondition: (level: "chapter" | "slide") => ListedItemDripRules["courseCondition"];
}

export interface ResumeChecks {
  enrolledCourses: () => Promise<EnrolmentResult>;
  liveChapters: (subjectId: string, packageSessionId: string) => Promise<LiveChapter[]>;
  liveSlides: (chapterId: string) => Promise<LiveSlide[]>;
  dripRules: (courseId: string, packageSessionId: string) => Promise<ResumeDripRules>;
  /** The institute's "finished" line for a slide. Absent: no count is worked out. */
  completionThreshold?: () => number;
}

export type VerifiedResume = ResumeEntry & { count?: LessonCount; coursePercent?: number | null };

/** A device entry can also be dropped once the server confirms it no longer exists. */
export interface DeviceResumeChecks extends ResumeChecks {
  forget: (courseId: string) => void;
}

/** How many device entries one dashboard visit will check before giving up. */
export const MAX_RESUME_CANDIDATES = 3;

interface ModuleRow {
  module?: { id?: string; percentage_completed?: number | null };
  percentage_completed?: number | null;
  chapters?: (LiveChapterRow & { chapter?: LiveChapterRow })[] | null;
}
interface LiveChapterRow {
  id?: string;
  is_hidden?: boolean | null;
  is_locked?: boolean | null;
  percentage_completed?: number | null;
  drip_condition?: unknown;
  drip_condition_json?: unknown;
}

/**
 * The chapters of a modules-with-chapters response. Chapter fields sit on the
 * row, or under `chapter` in the older shape. Anything unreadable throws: a
 * response this code cannot read is "could not check", never "removed".
 */
export function liveChaptersFrom(modules: unknown): LiveChapter[] {
  if (!Array.isArray(modules)) throw new Error("unexpected response shape");
  return (modules as ModuleRow[]).flatMap((row) =>
    (row.chapters ?? []).map((item) => {
      const chapter = item.chapter ?? item;
      const moduleId = row.module?.id;
      if (!chapter.id || !moduleId) throw new Error("unexpected response shape");
      return {
        chapterId: chapter.id,
        moduleId,
        open: chapter.is_hidden !== true && chapter.is_locked !== true,
        percentage: item.percentage_completed ?? chapter.percentage_completed ?? 0,
        modulePercentage: row.percentage_completed ?? row.module?.percentage_completed ?? 0,
        dripCondition: item.drip_condition ?? chapter.drip_condition,
      };
    }),
  );
}

const TEST_LIKE_TYPES = new Set(["QUIZ", "ASSESSMENT", "QUESTION"]);

/** Anything test-like is entered on purpose from its lesson, not one tap from the first screen. */
export const isTestLikeSlide = (sourceType?: string | null) =>
  TEST_LIKE_TYPES.has((sourceType ?? "").toUpperCase());

/** A lesson the first screen may offer. */
function isOfferableSlide(slide: LiveSlide): boolean {
  return !isTestLikeSlide(slide.source_type) && slide.is_hidden !== true && slide.is_locked !== true;
}

const closedByDrip = (evaluation: DripConditionEvaluation) =>
  evaluation.isLocked || evaluation.isHidden;

/**
 * Whether drip closes this lesson to the learner right now, by the evaluation the
 * lesson page and course page run. The lesson page opens something else in place
 * of a closed slide, and it does not look above the slide at all, so a lesson
 * offered from here has to clear every level on its own.
 *
 * Subjects are known one at a time here, so only their time rules can close one.
 */
export function lessonClosedByDrip(
  lesson: { subjectId: string; chapterId: string; slideId: string },
  chapters: LiveChapter[],
  slides: LiveSlide[],
  rules: ResumeDripRules,
  now: Date = new Date(),
): boolean {
  const { courseCondition, ...shared } = rules;
  const at = { ...shared, now };

  const listedSlides = slides.map((slide) => ({
    id: slide.id,
    percentage: slide.percentage_completed ?? 0,
    rowCondition: slide.drip_condition || slide.drip_condition_json,
  }));
  const slideIndex = listedSlides.findIndex((slide) => slide.id === lesson.slideId);
  const chapterCompletions = { [lesson.chapterId]: calculateOverallCompletion(slides) };
  if (
    closedByDrip(
      evaluateListedItem(
        "slide",
        listedSlides,
        slideIndex,
        { ...at, courseCondition: courseCondition("slide") },
        chapterCompletions,
      ),
    )
  ) {
    return true;
  }

  const listedChapters = chapters.map((chapter) => ({
    id: chapter.chapterId,
    percentage: chapter.percentage ?? 0,
    rowCondition: chapter.dripCondition,
  }));
  const chapterIndex = listedChapters.findIndex((chapter) => chapter.id === lesson.chapterId);
  if (
    closedByDrip(
      evaluateListedItem("chapter", listedChapters, chapterIndex, {
        ...at,
        courseCondition: courseCondition("chapter"),
      }),
    )
  ) {
    return true;
  }

  const moduleId = chapters[chapterIndex]?.moduleId;
  const listedModules = [...new Set(chapters.map((chapter) => chapter.moduleId))].map((id) => ({
    id,
    percentage: chapters.find((chapter) => chapter.moduleId === id)?.modulePercentage ?? 0,
  }));
  const moduleIndex = listedModules.findIndex((item) => item.id === moduleId);
  if (closedByDrip(evaluateListedItem("module", listedModules, moduleIndex, at))) return true;

  return closedByDrip(
    evaluateListedItem("subject", [{ id: lesson.subjectId, percentage: 0 }], 0, at),
  );
}

/**
 * The chapter's lessons as the learner's outline lists them: drip "hide" removes
 * one, a lock does not. Each lesson counts by state, so order and gaps cannot
 * change the result, and a quiz is one lesson like any other. Old rows can hold
 * text or huge numbers: anything unreadable is not finished, as the server reads it.
 */
export function countLessons(
  chapterId: string,
  chapters: LiveChapter[],
  slides: LiveSlide[],
  rules: ResumeDripRules | null,
  threshold: number,
  now: Date = new Date(),
): LessonCount {
  const percentage = (slide: LiveSlide) => {
    const value = Number(slide.percentage_completed);
    return Number.isFinite(value) ? value : 0;
  };
  const listed = slides.map((slide) => ({
    id: slide.id,
    percentage: percentage(slide),
    rowCondition: slide.drip_condition || slide.drip_condition_json,
  }));
  const hiddenByDrip = (index: number) => {
    if (!rules) return false;
    const { courseCondition, ...shared } = rules;
    try {
      return evaluateListedItem(
        "slide",
        listed,
        index,
        { ...shared, now, courseCondition: courseCondition("slide") },
        { [chapterId]: calculateOverallCompletion(slides) },
      ).isHidden;
    } catch {
      return false;
    }
  };
  const visible = slides.filter(
    (slide, index) => slide.is_hidden !== true && !hiddenByDrip(index),
  );
  return {
    done: visible.filter((slide) => percentage(slide) >= threshold).length,
    total: visible.length,
    partOfCourse: chapters.length > 1,
  };
}

/** The count is extra: it can never cost the learner the resume answer itself. */
function safeCount(
  checks: ResumeChecks,
  chapterId: string,
  chapters: LiveChapter[],
  slides: LiveSlide[],
  rules: ResumeDripRules | null,
): LessonCount | undefined {
  if (!checks.completionThreshold) return undefined;
  try {
    return countLessons(chapterId, chapters, slides, rules, checks.completionThreshold());
  } catch {
    return undefined;
  }
}

const isFinished = (row: EnrolledCourseRow) => Number(row.percentage_completed ?? 0) >= 100;

/**
 * The course percent to show for a lesson opened in `row`. A finished batch of a course
 * the learner also holds unfinished in another batch shows the unfinished one furthest
 * along, as the course list does, so a lesson offered to continue is never drawn as a
 * finished course. Which batch the lesson opens in is not affected.
 */
function shownPercent(row: EnrolledCourseRow, rows: EnrolledCourseRow[]): number | null {
  if (!isFinished(row)) return coursePercentOf(row.percentage_completed);
  let furthest: number | null = null;
  for (const other of rows) {
    if (isFinished(other)) continue;
    const percent = coursePercentOf(other.percentage_completed);
    if (percent !== null && (furthest === null || percent > furthest)) furthest = percent;
  }
  return furthest;
}

async function findLesson(
  checks: ResumeChecks,
  lesson: {
    courseId: string;
    subjectId: string;
    batchId: string;
    chapterId: string;
    slideId: string;
  },
): Promise<{ chapter?: LiveChapter; slide?: LiveSlide; closed: boolean; count?: LessonCount }> {
  const [chapters, slides] = await Promise.all([
    checks.liveChapters(lesson.subjectId, lesson.batchId),
    checks.liveSlides(lesson.chapterId),
  ]);
  const chapter = chapters.find((c) => c.chapterId === lesson.chapterId);
  const slide = slides.find((s) => s.id === lesson.slideId);
  if (!chapter || !slide) return { chapter, slide, closed: false };

  const offerable = chapter.open && isOfferableSlide(slide);
  const rules = offerable ? await checks.dripRules(lesson.courseId, lesson.batchId) : null;
  return {
    chapter,
    slide,
    closed: !offerable || (rules ? lessonClosedByDrip(lesson, chapters, slides, rules) : false),
    count: safeCount(checks, lesson.chapterId, chapters, slides, rules),
  };
}

/**
 * The most recent device entry that is still true for this learner: the course
 * is still theirs and unfinished, and its chapter and lesson are still live.
 * Titles and ids come back as the server has them now. A failed request rejects
 * and forgets nothing, and a partial enrolment list forgets nothing: "could not
 * check" is not "removed".
 */
export async function verifyResume(
  candidates: ResumeEntry[],
  checks: DeviceResumeChecks,
): Promise<VerifiedResume | null> {
  if (candidates.length === 0) return null;
  const { courses, complete } = await checks.enrolledCourses();

  for (const entry of candidates.slice(0, MAX_RESUME_CANDIDATES)) {
    const rows = courses.filter((row) => row.id === entry.courseId);
    if (rows.length === 0) {
      // An empty list can also mean the learner's list did not load, so it proves nothing.
      if (complete && courses.length > 0) checks.forget(entry.courseId);
      continue;
    }
    if (rows.every(isFinished)) continue;

    // Prefer the recorded batch; a learner may have moved to another one.
    const row = rows.find((r) => r.package_session_id === entry.sessionId) ?? rows[0]!;
    const { chapter, slide, closed, count } = await findLesson(checks, {
      courseId: entry.courseId,
      subjectId: entry.subjectId,
      batchId: row.package_session_id,
      chapterId: entry.chapterId,
      slideId: entry.slideId,
    });
    if (!chapter || !slide) {
      checks.forget(entry.courseId);
      continue;
    }
    if (closed) continue;

    return {
      ...entry,
      slideTitle: slide.title || entry.slideTitle,
      courseName: row.package_name || entry.courseName,
      sessionId: row.package_session_id,
      moduleId: chapter.moduleId,
      count,
      coursePercent: shownPercent(row, rows),
    };
  }
  return null;
}

/** The in-progress lessons the server lists that a first screen could offer, unchecked. */
export function serverLessons(slides: DashboardSlide[] | undefined): DashboardSlide[] {
  return slides?.filter((slide) => slide.slide_id && !isTestLikeSlide(slide.source_type)) ?? [];
}

export interface VerifiedServerLesson {
  slide: DashboardSlide;
  courseName?: string;
  count?: LessonCount;
  coursePercent?: number | null;
}

/**
 * The first server-listed lesson that is true for this learner in this
 * institute: its course and batch are in their enrolment list, unfinished, and
 * the chapter and lesson are live in that batch. The list has no recency order,
 * so a caller must not present the result as their last position. A row that
 * fails is passed over, and a device entry is never touched from here.
 */
export async function verifyServerLessons(
  lessons: DashboardSlide[],
  checks: ResumeChecks,
): Promise<VerifiedServerLesson | null> {
  if (lessons.length === 0) return null;
  const { courses } = await checks.enrolledCourses();

  let looked = 0;
  for (const lesson of lessons) {
    const row = courses.find(
      (c) => c.id === lesson.package_id && c.package_session_id === lesson.package_session_id,
    );
    if (!row || isFinished(row)) continue;
    if (looked++ === MAX_RESUME_CANDIDATES) return null;

    const { chapter, slide, closed, count } = await findLesson(checks, {
      courseId: lesson.package_id,
      subjectId: lesson.subject_id,
      batchId: row.package_session_id,
      chapterId: lesson.chapter_id,
      slideId: lesson.slide_id,
    });
    if (!chapter || !slide || closed) continue;

    return {
      slide: {
        ...lesson,
        slide_title: slide.title || lesson.slide_title,
        module_id: chapter.moduleId,
      },
      courseName: row.package_name || undefined,
      count,
      coursePercent: coursePercentOf(row.percentage_completed),
    };
  }
  return null;
}
