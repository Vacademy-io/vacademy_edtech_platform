// Small read helpers over loosely-typed API payloads (course-init and the
// package-detail endpoint). Kept as pure functions so the page component
// doesn't need inline structural casts.

import type { EnrolledSession } from "@/hooks/use-enrollment-status";
import type { PackageSessionSummary } from "./course-details-types";

export type CourseInitSubject = {
  id: string;
  subject_name?: string;
  subject_code?: string;
  credit?: number;
  thumbnail_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  subject_order?: number;
};

export function getCourseDepthFromInit(
  courseDetailsData: unknown,
): number | undefined {
  return (courseDetailsData as { course?: { course_depth?: number } } | null)
    ?.course?.course_depth;
}

// Subjects of the first session's first level — used to call
// modules-with-chapters (and show content) before the form is populated.
export function getFirstLevelSubjectsFromInit(
  courseDetailsData: unknown,
): CourseInitSubject[] | undefined {
  const data = courseDetailsData as
    | {
        sessions?: Array<{
          level_with_details?: Array<{ subjects?: CourseInitSubject[] }>;
        }>;
      }
    | null
    | undefined;
  const subjects = data?.sessions?.[0]?.level_with_details?.[0]?.subjects;
  return Array.isArray(subjects) && subjects.length > 0 ? subjects : undefined;
}

// read_time_in_minutes lives either at the top level or under `data`
// depending on which service shape responded.
export function extractReadTimeMinutes(data: unknown): number | undefined {
  if (!data) return undefined;
  const rawData = data as Record<string, unknown>;

  if (
    "read_time_in_minutes" in rawData &&
    typeof rawData.read_time_in_minutes === "number" &&
    rawData.read_time_in_minutes
  ) {
    return rawData.read_time_in_minutes;
  }

  const nested = rawData.data;
  if (nested && typeof nested === "object" && "read_time_in_minutes" in nested) {
    const value = (nested as Record<string, unknown>).read_time_in_minutes;
    if (typeof value === "number" && value) return value;
  }

  return undefined;
}

type InstructorLike = { full_name?: string; username?: string };
type CourseAuthorLike = {
  course?: {
    created_by_name?: string;
    author_name?: string;
    owner_name?: string;
  };
};

// Author display name, in the order the page has always preferred:
// form instructors → package-detail instructors → course-init author fields →
// package-detail author fields.
export function derivePrimaryInstructorName({
  formInstructors,
  packageDetailData,
  courseInitData,
}: {
  formInstructors: Array<{ name?: string; full_name?: string }> | undefined;
  packageDetailData: unknown;
  courseInitData: unknown;
}): string | undefined {
  const fromForm =
    formInstructors?.[0]?.name || formInstructors?.[0]?.full_name;
  if (fromForm) return fromForm;

  const packageInstructors = (
    packageDetailData as { instructors?: InstructorLike[] } | null | undefined
  )?.instructors;
  const fromPackageInstructors =
    packageInstructors?.[0]?.full_name || packageInstructors?.[0]?.username;
  if (fromPackageInstructors) return fromPackageInstructors;

  const initCourse = (courseInitData as CourseAuthorLike | null | undefined)
    ?.course;
  const fromInit =
    initCourse?.created_by_name ||
    initCourse?.author_name ||
    initCourse?.owner_name;
  if (fromInit) return fromInit;

  const packageCourse = (
    packageDetailData as CourseAuthorLike | null | undefined
  )?.course;
  return (
    packageCourse?.created_by_name ||
    packageCourse?.author_name ||
    packageCourse?.owner_name ||
    undefined
  );
}

// Enrolled sessions built from the login-time student snapshot without the
// institute's batches are skeletal: only the package_session id is known, and
// package / session / level ids are "". Every check on the course page matches
// on package_dto.id (plus session and level), so a skeletal entry reads as
// "not enrolled" — preview mode, slides not clickable. course-init lists this
// course's package sessions in full, so fill the skeletal entries from it.
export function fillEnrolledSessionsFromInit(
  enrolledSessions: EnrolledSession[],
  courseDetailsData: unknown,
): EnrolledSession[] {
  const packageSessions = (
    courseDetailsData as { package_sessions?: unknown } | null | undefined
  )?.package_sessions;
  if (!Array.isArray(packageSessions) || packageSessions.length === 0) {
    return enrolledSessions;
  }
  const byId = new Map(
    (packageSessions as PackageSessionSummary[]).map((ps) => [ps.id, ps]),
  );
  return enrolledSessions.map((enrolled) => {
    const ps = byId.get(enrolled.id);
    if (!ps?.package_dto?.id || enrolled.package_dto.id) return enrolled;
    return {
      ...enrolled,
      session: {
        id: ps.session?.id ?? "",
        session_name: ps.session?.session_name ?? enrolled.session.session_name,
        status: ps.session?.status ?? enrolled.session.status,
        start_date: ps.session?.start_date ?? enrolled.session.start_date,
      },
      level: {
        id: ps.level?.id ?? "",
        level_name: ps.level?.level_name ?? enrolled.level.level_name,
        duration_in_days: ps.level?.duration_in_days ?? null,
        thumbnail_id: ps.level?.thumbnail_id ?? null,
      },
      start_time: ps.start_time ?? enrolled.start_time,
      package_dto: {
        id: ps.package_dto.id,
        package_name: ps.package_dto.package_name ?? enrolled.package_dto.package_name,
        thumbnail_id: ps.package_dto.thumbnail_file_id || null,
      },
    };
  });
}
