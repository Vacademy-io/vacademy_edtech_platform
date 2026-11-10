import axios from "axios";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { urlPublicCourseDetails } from "@/constants/urls";
import type { CoursePackage } from "@/types/course-catalog/course-catalog-list";

/**
 * Where a learner stands in an enrolled course. Derived from
 * percentage_completed rather than from the bucket the row arrived in, so a
 * course sitting at 100% inside the PROGRESS page still reads as completed.
 */
export type EnrolledCourseState = "IN_PROGRESS" | "NOT_STARTED" | "COMPLETED";

export interface EnrolledCourse {
  id: string;
  packageSessionId: string;
  name: string;
  levelName: string;
  previewImageId: string;
  percentComplete: number;
  readTimeInMinutes: number;
  state: EnrolledCourseState;
}

// Dashboard-sized page: the widget lists a handful and links to the catalogue
// for the rest, so paging through every enrollment would be wasted work.
const PAGE_SIZE = 12;
// "Show every enrolled course" (allCourses.showAllEnrolledOnDashboard): one wide page per bucket.
const ALL_PAGE_SIZE = 200;
const pageSize = (opts?: { all?: boolean }) => (opts?.all ? ALL_PAGE_SIZE : PAGE_SIZE);

const searchBody = (type: "PROGRESS" | "COMPLETED") => ({
  status: [] as string[],
  level_ids: [] as string[],
  faculty_ids: [] as string[],
  search_by_name: "",
  tag: [] as string[],
  min_percentage_completed: 0,
  max_percentage_completed: 0,
  type,
  // snake_case: the backend sorts on the entity column name. `createdAt`
  // silently falls back to an unsorted page.
  sort_columns: { created_at: "DESC" },
});

// The dashboard's course widget and its first-run check can ask for the same
// page at once, so one request answers both.
const bucketsInFlight = new Map<string, Promise<CoursePackage[]>>();

// The same check can also run just after the widget has its answer. The first
// page of any size says whether the learner has started, so it reads that instead
// of asking again. The widget itself always asks.
const ANSWER_REUSE_MS = 30_000;
const bucketAnswers = new Map<string, { at: number; rows: CoursePackage[] }>();
const answerListeners = new Set<() => void>();
// Moves on at every logout, so an answer for the learner before cannot land after it.
let answersEpoch = 0;

const fetchBucket = (
  instituteId: string,
  type: "PROGRESS" | "COMPLETED",
  size: number = PAGE_SIZE,
  signal?: AbortSignal,
): Promise<CoursePackage[]> => {
  const key = `${instituteId}|${type}|${size}`;
  const inFlight = bucketsInFlight.get(key);
  if (inFlight) return inFlight;
  const epoch = answersEpoch;
  const request: Promise<CoursePackage[]> = authenticatedAxiosInstance
    .post(urlPublicCourseDetails, searchBody(type), {
      params: { instituteId, page: 0, size },
      headers: { accept: "*/*", "Content-Type": "application/json" },
      signal,
    })
    .then((response) => {
      const rows = (response.data?.content ?? []) as CoursePackage[];
      if (epoch === answersEpoch) {
        bucketAnswers.set(`${instituteId}|${type}`, { at: Date.now(), rows });
        answerListeners.forEach((listener) => listener());
      }
      return rows;
    })
    .finally(() => {
      if (bucketsInFlight.get(key) === request) bucketsInFlight.delete(key);
    });
  bucketsInFlight.set(key, request);
  return request;
};

const recentBucket = (instituteId: string, type: "PROGRESS" | "COMPLETED", size: number) => {
  const answer = bucketAnswers.get(`${instituteId}|${type}`);
  if (answer && Date.now() - answer.at < ANSWER_REUSE_MS) return Promise.resolve(answer.rows);
  // A widget leaving the page cancels its request, which may be the one joined here.
  return fetchBucket(instituteId, type, size).catch((error) => {
    if (axios.isCancel(error)) return fetchBucket(instituteId, type, size);
    throw error;
  });
};

export interface EnrolmentAnswerRow {
  percentage_completed?: number | string | null;
  read_time_in_minutes?: number | null;
}

// The whole enrolment list as the course pages and the resume check last read it. A
// learner who enrols in the app comes back through one of them, so what Home knows
// follows without Home asking.
const wholeLists = new Map<string, { at: number; rows: EnrolmentAnswerRow[] }>();

/** Where the answers are now: pass it back to noteEnrolmentList with a list asked for here. */
export const enrolmentAnswersEpoch = (): number => answersEpoch;

/** Keeps a whole list, unless a logout came between asking for it and now. */
export const noteEnrolmentList = (
  instituteId: string,
  rows: EnrolmentAnswerRow[],
  askedAt: number = answersEpoch,
): void => {
  if (askedAt !== answersEpoch) return;
  wholeLists.set(instituteId, { at: Date.now(), rows });
  answerListeners.forEach((listener) => listener());
};

/**
 * Drops every answer kept for the learner who was signed in. These are keyed by
 * institute only, so logout must call this (through clearUserScopedReadCaches).
 */
export const forgetEnrolmentAnswers = (): void => {
  answersEpoch += 1;
  bucketAnswers.clear();
  wholeLists.clear();
  bucketsInFlight.clear();
  answerListeners.forEach((listener) => listener());
};

export const subscribeToEnrolmentAnswers = (listener: () => void): (() => void) => {
  answerListeners.add(listener);
  return () => {
    answerListeners.delete(listener);
  };
};

/**
 * The latest enrolment list already answered this visit, or null until there is one.
 * Never asks for it: a dashboard that has not needed it yet stays unanswered.
 */
export const answeredEnrolments = (instituteId: string): EnrolmentAnswerRow[] | null => {
  const progress = bucketAnswers.get(`${instituteId}|PROGRESS`);
  const completed = bucketAnswers.get(`${instituteId}|COMPLETED`);
  const whole = wholeLists.get(instituteId);
  if (whole && (!progress || !completed || whole.at >= Math.min(progress.at, completed.at))) {
    return whole.rows;
  }
  return progress && completed ? [...progress.rows, ...completed.rows] : null;
};

/**
 * Has the learner started anything across their enrollments? A bucket that fails
 * says nothing either way, so the other one can still answer yes. Pass the same
 * `all` as the course widget: equal pages share one request, whichever asks first.
 */
export const fetchEnrolledHasProgress = async (
  instituteId: string,
  opts?: { all?: boolean },
): Promise<boolean> => {
  const size = pageSize(opts);
  const [progress, completed] = await Promise.allSettled([
    recentBucket(instituteId, "PROGRESS", size),
    recentBucket(instituteId, "COMPLETED", size),
  ]);
  return (
    (completed.status === "fulfilled" && completed.value.length > 0) ||
    (progress.status === "fulfilled" &&
      progress.value.some((row) => (row.percentage_completed ?? 0) > 0))
  );
};

/**
 * Courses that don't use levels still get a scaffold row the platform names
 * literally "default"/"DEFAULT". Rendering that under a course title shows the
 * learner "default" where a level belongs, so treat it as absent — the same
 * suppression enroll-form.tsx and the downloads page already apply.
 */
const PLACEHOLDER_NAMES = new Set(["default", "untitled", "n/a", "-"]);

const meaningfulName = (name?: string | null): string => {
  const trimmed = (name || "").trim();
  return trimmed && !PLACEHOLDER_NAMES.has(trimmed.toLowerCase()) ? trimmed : "";
};

const toEnrolledCourse = (c: CoursePackage): EnrolledCourse => {
  const percent = Math.min(100, Math.max(0, Math.round(c.percentage_completed ?? 0)));
  return {
    id: c.id,
    // The catalogue passes this straight into the course-details search params,
    // which reject undefined — normalise the null the API can return.
    packageSessionId: c.package_session_id ?? "",
    name: c.package_name ?? "",
    levelName: meaningfulName(c.level_name),
    previewImageId: c.course_preview_image_media_id || c.thumbnail_file_id || "",
    percentComplete: percent,
    readTimeInMinutes: c.read_time_in_minutes ?? 0,
    state:
      percent >= 100 ? "COMPLETED" : percent > 0 ? "IN_PROGRESS" : "NOT_STARTED",
  };
};

// Sort key, not a display order: closest-to-finishing first, then untouched
// courses, then the ones already done — a "what do I open next" ordering
// rather than the enrollment date the API sorts by.
const STATE_RANK: Record<EnrolledCourseState, number> = {
  IN_PROGRESS: 0,
  NOT_STARTED: 1,
  COMPLETED: 2,
};

/**
 * Every course the learner is enrolled in, ready for the dashboard widget.
 *
 * Two buckets, because the backend splits them: PROGRESS is
 * getIncompleteMappedPackages (assigned courses below 100%) and COMPLETED is
 * its counterpart — asking for either alone loses half the enrollments. A
 * failure on one side still returns the other rather than an empty widget.
 */
export const fetchEnrolledCourses = async (
  instituteId: string,
  signal?: AbortSignal,
  opts?: { all?: boolean },
): Promise<EnrolledCourse[]> => {
  const size = pageSize(opts);
  const [progress, completed] = await Promise.allSettled([
    fetchBucket(instituteId, "PROGRESS", size, signal),
    fetchBucket(instituteId, "COMPLETED", size, signal),
  ]);
  if (progress.status === "rejected" && completed.status === "rejected") {
    throw progress.reason;
  }

  const rows = [
    ...(progress.status === "fulfilled" ? progress.value : []),
    ...(completed.status === "fulfilled" ? completed.value : []),
  ];

  // A course can legitimately appear in both buckets (a 100% row that the
  // PROGRESS query still matches); the first sighting wins.
  const byPackageSession = new Map<string, EnrolledCourse>();
  for (const row of rows) {
    if (!row?.id) continue;
    const course = toEnrolledCourse(row);
    const key = course.packageSessionId || course.id;
    if (!byPackageSession.has(key)) byPackageSession.set(key, course);
  }

  return Array.from(byPackageSession.values()).sort((a, b) => {
    const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (byState !== 0) return byState;
    // Within "in progress", the nearly-finished course comes first.
    if (a.state === "IN_PROGRESS") return b.percentComplete - a.percentComplete;
    return a.name.localeCompare(b.name);
  });
};
