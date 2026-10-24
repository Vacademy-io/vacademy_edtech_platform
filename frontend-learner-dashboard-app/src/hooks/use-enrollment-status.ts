import { useState, useEffect, useCallback } from "react";
import { Preferences } from "@capacitor/preferences";
import {
  hasUserDonated,
  fetchEnrolledCoursePackages,
  type EnrolledCourseSummary,
} from "@/services/user-enrollment-status";
import { useInstituteDetailsStore } from "@/stores/study-library/useInstituteDetails";

export interface EnrolledSession {
  id: string;
  session: {
    id: string;
    session_name: string;
    status: string;
    start_date: string;
  };
  level: {
    id: string;
    level_name: string;
    duration_in_days: number | null;
    thumbnail_id: string | null;
  };
  start_time: string | null;
  status: string;
  package_dto: {
    id: string;
    package_name: string;
    thumbnail_id?: string | null;
  };
}

export const useEnrollmentStatus = (instituteId: string | null) => {
  const [enrolledSessions, setEnrolledSessions] = useState<EnrolledSession[]>(
    [],
  );
  const [userHasDonated, setUserHasDonated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Start as true since we're loading on mount
  const [donationCheckCompleted, setDonationCheckCompleted] = useState(false);

  const instituteDetails = useInstituteDetailsStore(
    (state) => state.instituteDetails,
  );

  // Fetch enrolled sessions by merging two sources:
  //   1) Capacitor "students" Preferences + instituteDetails.batches_for_sessions
  //      — original source of truth; captures every batch the user is assigned to
  //      at login time (including assignments with no learner-operation row yet).
  //   2) learner-packages/v1/search (type=PROGRESS + COMPLETED, unioned)
  //      — picks up enrollments added after login (e.g. paid course purchases)
  //      that the Preferences snapshot doesn't yet know about.
  // Dedup by package_session_id, preferring the (1) entry when both exist because
  // it carries fully-resolved session/level UUIDs from batches_for_sessions.
  // Passive re-reads (mount, store updates, window focus) go through the
  // service-level 30s memo; pass { force: true } only after an enrollment
  // change so the fresh state is fetched immediately.
  const fetchEnrolledSessions = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const batchesForSessions = instituteDetails?.batches_for_sessions ?? [];
      const batchById = new Map(batchesForSessions.map((b) => [b.id, b]));

      // --- Source 1: Preferences "students" (original logic) ---
      const localSessions: EnrolledSession[] = [];
      const studentsResult = await Preferences.get({ key: "students" });
      if (studentsResult.value) {
        const students = JSON.parse(studentsResult.value);
        const studentList = Array.isArray(students) ? students : [students];
        const packageSessionIds = studentList
          .map((s: { package_session_id?: string }) => s.package_session_id)
          .filter(Boolean);

        if (packageSessionIds.length > 0) {
          if (batchesForSessions.length > 0) {
            for (const batch of batchesForSessions) {
              if (!packageSessionIds.includes(batch.id)) continue;
              localSessions.push({
                id: batch.id,
                session: {
                  id: batch.session.id,
                  session_name: batch.session.session_name,
                  status: batch.session.status,
                  start_date: batch.session.start_date,
                },
                level: {
                  id: batch.level.id,
                  level_name: batch.level.level_name,
                  duration_in_days: batch.level.duration_in_days,
                  thumbnail_id: batch.level.thumbnail_id,
                },
                start_time: batch.start_time,
                status: batch.status,
                package_dto: {
                  id: batch.package_dto.id,
                  package_name: batch.package_dto.package_name,
                  thumbnail_id: batch.package_dto.thumbnail_id ?? null,
                },
              });
            }
          } else {
            // Fallback: institute store empty — build skeletal entries from
            // student records (package_dto.id stays "" because the student
            // record doesn't carry a package id).
            for (const s of studentList) {
              if (!s.package_session_id) continue;
              localSessions.push({
                id: s.package_session_id,
                session: {
                  id: "",
                  session_name: s.session_name || "",
                  status: "ACTIVE",
                  start_date: "",
                },
                level: {
                  id: "",
                  level_name: s.level_name || "",
                  duration_in_days: null,
                  thumbnail_id: null,
                },
                start_time: null,
                status: s.status || "ACTIVE",
                package_dto: {
                  id: "",
                  package_name: s.package_name || "",
                  thumbnail_id: null,
                },
              });
            }
          }
        }
      }

      // --- Source 2: backend PROGRESS search (best-effort) ---
      let backendSessions: EnrolledSession[] = [];
      if (instituteId) {
        try {
          const enrolledCourses = await fetchEnrolledCoursePackages(
            instituteId,
            opts,
          );
          backendSessions = enrolledCourses.map(
            (course: EnrolledCourseSummary) => {
              const batch = batchById.get(course.package_session_id);
              return {
                id: course.package_session_id,
                session: {
                  id: batch?.session?.id ?? course.session_id ?? "",
                  session_name:
                    batch?.session?.session_name ?? course.session_name ?? "",
                  status: batch?.session?.status ?? "ACTIVE",
                  start_date: batch?.session?.start_date ?? "",
                },
                level: {
                  id: batch?.level?.id ?? course.level_id ?? "",
                  level_name:
                    batch?.level?.level_name ?? course.level_name ?? "",
                  duration_in_days: batch?.level?.duration_in_days ?? null,
                  thumbnail_id: batch?.level?.thumbnail_id ?? null,
                },
                start_time: batch?.start_time ?? null,
                status: batch?.status ?? "ACTIVE",
                package_dto: {
                  id: course.id,
                  package_name: course.package_name,
                  thumbnail_id: batch?.package_dto?.thumbnail_id ?? null,
                },
              };
            },
          );
        } catch {
          // If the backend call fails, fall back to local-only data — never worse
          // than the original behavior.
        }
      }

      // Merge, preferring local entries (richer session/level data) on conflict
      // — except the skeletal fallback ones: they carry no package id, and
      // letting one replace the backend entry makes an enrolled learner look
      // un-enrolled (course page in preview mode, slides not clickable). The
      // course page fills the institute store from details-non-batches, so
      // batches_for_sessions is empty there and every local entry is skeletal.
      const merged = new Map<string, EnrolledSession>();
      for (const s of backendSessions) merged.set(s.id, s);
      for (const s of localSessions) {
        const backend = merged.get(s.id);
        merged.set(s.id, backend && !s.package_dto.id ? backend : s);
      }

      setEnrolledSessions(Array.from(merged.values()));
    } catch {
      setEnrolledSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [instituteId, instituteDetails]);

  // Check donation status only when instituteId is available
  const checkDonationStatus = useCallback(async (opts?: { force?: boolean }) => {
    if (!instituteId) {
      setUserHasDonated(false);
      return;
    }

    try {
      const hasDonated = await hasUserDonated(instituteId, opts);
      setUserHasDonated(hasDonated);
      setDonationCheckCompleted(true);
    } catch {
      setUserHasDonated(false);
      setDonationCheckCompleted(true);
    }
  }, [instituteId]); // Add instituteId as dependency

  // Add a new enrolled session (optimistic update + refresh from API)
  const addEnrolledSession = useCallback(
    async (newSession: EnrolledSession) => {
      // Optimistic update: add to local state immediately
      setEnrolledSessions((prev) => {
        const exists = prev.some(
          (session) =>
            session.package_dto.id === newSession.package_dto.id &&
            session.session.id === newSession.session.id &&
            session.level.id === newSession.level.id,
        );
        if (exists) return prev;
        return [...prev, newSession];
      });

      // Also update Preferences for backward compatibility
      try {
        const currentSessions = [...(enrolledSessions || []), newSession];
        await Preferences.set({
          key: "sessionList",
          value: JSON.stringify(currentSessions),
        });
      } catch {
        // Silent error handling
      }

      // Refresh from API to get the latest state (bypass the read memo —
      // enrollment just changed)
      await fetchEnrolledSessions({ force: true });
    },
    [enrolledSessions, fetchEnrolledSessions],
  );

  // Check if user is enrolled in a specific course
  const isEnrolledInCourse = useCallback(
    (courseId: string, sessionId?: string, levelId?: string) => {
      const result = (enrolledSessions || []).some((session) => {
        const courseMatch = session.package_dto.id === courseId;

        if (sessionId && levelId) {
          return (
            courseMatch &&
            session.session.id === sessionId &&
            session.level.id === levelId
          );
        }

        return courseMatch;
      });

      return result;
    },
    [enrolledSessions],
  ); // Add enrolledSessions dependency

  // Refresh all data (explicit refresh API — bypasses the read memos)
  const refreshData = useCallback(async () => {
    try {
      await Promise.all([
        fetchEnrolledSessions({ force: true }),
        checkDonationStatus({ force: true }),
      ]);
    } catch {
      // Silent error handling
    } finally {
      setIsLoading(false);
    }
  }, [fetchEnrolledSessions, checkDonationStatus]); // Add dependencies

  // Fetch enrolled sessions on mount and when dependencies change
  useEffect(() => {
    fetchEnrolledSessions();
  }, [fetchEnrolledSessions]);

  // Also fetch enrolled sessions when the page becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchEnrolledSessions();
      }
    };

    const handleFocus = () => {
      fetchEnrolledSessions();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchEnrolledSessions]);

  // Check donation status when instituteId changes
  useEffect(() => {
    if (instituteId) {
      // Only check donation status if we haven't completed it for this instituteId
      if (!donationCheckCompleted) {
        setIsLoading(true);
        checkDonationStatus();
      }
    } else {
      // Reset donation status when instituteId is null
      setUserHasDonated(false);
      setDonationCheckCompleted(false);
    }
  }, [instituteId, checkDonationStatus, donationCheckCompleted]); // Add donationCheckCompleted as dependency

  // Function to manually refresh donation status (useful after successful donation)
  const refreshDonationStatus = useCallback(async () => {
    if (instituteId) {
      setDonationCheckCompleted(false);
      setIsLoading(true);
      await checkDonationStatus({ force: true });
    }
  }, [instituteId, checkDonationStatus]);

  return {
    enrolledSessions: enrolledSessions || [],
    userHasDonated: userHasDonated === null ? false : userHasDonated,
    isLoading,
    isEnrolledInCourse,
    addEnrolledSession,
    refreshData,
    refreshDonationStatus,
  };
};
