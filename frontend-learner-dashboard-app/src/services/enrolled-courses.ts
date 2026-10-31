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

const fetchBucket = async (
  instituteId: string,
  type: "PROGRESS" | "COMPLETED",
  signal?: AbortSignal,
  size: number = PAGE_SIZE,
): Promise<CoursePackage[]> => {
  const response = await authenticatedAxiosInstance.post(
    urlPublicCourseDetails,
    searchBody(type),
    {
      params: { instituteId, page: 0, size },
      headers: { accept: "*/*", "Content-Type": "application/json" },
      signal,
    },
  );
  return (response.data?.content ?? []) as CoursePackage[];
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
  const size = opts?.all ? ALL_PAGE_SIZE : PAGE_SIZE;
  const [progress, completed] = await Promise.allSettled([
    fetchBucket(instituteId, "PROGRESS", signal, size),
    fetchBucket(instituteId, "COMPLETED", signal, size),
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
