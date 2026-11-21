import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getInstituteId } from "@/constants/helper";
import { fetchEnrolledCourses, type EnrolledCourse } from "@/services/enrolled-courses";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { useCurrentInstituteId } from "@/services/points";

/** A list that has not answered by now is treated as unreadable, so no card waits on it forever. */
export const ENROLLED_MAX_WAIT_MS = 6_000;

export interface FunEnrolledCourses {
  /** In the service's own order. Null while it is out, or when it could not be read. */
  courses: EnrolledCourse[] | null;
  /** Student Display Settings → allCourses.showAllEnrolledOnDashboard. */
  showAll: boolean;
  /** Still out, and has not yet waited ENROLLED_MAX_WAIT_MS. */
  pending: boolean;
  failed: boolean;
}

/**
 * The enrolled courses, read once for the Fun hero (a new learner's first course)
 * and the course tiles. The same page size as the classic course widget, so the
 * service shares one request per bucket with anything asking at the same time.
 */
export function useFunEnrolledCourses(): FunEnrolledCourses {
  const instituteId = useCurrentInstituteId();
  const query = useQuery({
    queryKey: ["fun-enrolled-courses", instituteId],
    enabled: instituteId !== undefined,
    queryFn: async ({ signal }) => {
      const id = await getInstituteId();
      if (!id) throw new Error("no institute");
      const settings = await getStudentDisplaySettings(false).catch(() => null);
      const all = settings?.allCourses?.showAllEnrolledOnDashboard === true;
      const courses = await fetchEnrolledCourses(id, signal, { all });
      return { courses, showAll: all };
    },
    staleTime: 30_000,
    retry: false,
  });

  const [waitOver, setWaitOver] = useState(false);
  const isPending = query.isPending;
  useEffect(() => {
    if (!isPending) return;
    const id = window.setTimeout(() => setWaitOver(true), ENROLLED_MAX_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [isPending]);

  return {
    courses: query.data?.courses ?? null,
    showAll: query.data?.showAll ?? false,
    pending: isPending && !waitOver,
    failed: query.isError,
  };
}
