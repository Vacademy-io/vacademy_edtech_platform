import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { fetchSlidesByChapterId, type Slide } from "@/hooks/study-library/use-slides";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import {
  clearResumeForCourse,
  listResumes,
  RESUME_ROUTE,
  resumeSearchParams,
  useResumeScope,
} from "@/services/resume-thread";
import { fetchModulesWithChapters } from "@/services/study-library/getModulesWithChapters";
import { fetchEnrolmentLookup } from "@/services/user-enrollment-status";
import { fetchEnrollmentAnchor, readInstituteDripSettings } from "@/services/drip-schedule";
import { useDripConditionStore } from "@/stores/study-library/drip-conditions-store";
import {
  enforceableCondition,
  getConditionForLevel,
  parseDripCondition,
  resolveDripCondition,
  type DripConditionJson,
  type RelativeDateParams,
} from "@/utils/drip-conditions";
import type { DashboardSlide } from "../-types/dashboard-data-types";
import {
  liveChaptersFrom,
  MAX_RESUME_CANDIDATES,
  serverLessons,
  verifyResume,
  verifyServerLessons,
  type LiveSlide,
  type ResumeChecks,
  type ResumeDripRules,
  type ResumeTarget,
  type VerifiedResume,
} from "../-lib/resume-target";

/** Matches useSlides, so a check's answer is as fresh as the lesson would accept. */
const CHECK_STALE_MS = 60_000;

/** Matches the memo the same lookup fills for other readers. */
const ENROLMENT_STALE_MS = 30_000;

/** How long a visit holds a slot for the answer before going on without it. */
export const RESUME_WAIT_MS = 3_000;

/** A slot held this long has been seen and aimed around, so it stays once the answer lands. */
const SLOT_SEEN_MS = 1_000;

function asArray<T>(value: unknown): T[] {
  const list = Array.isArray(value) ? value : (value as { data?: unknown } | null)?.data;
  // A 200 of another shape is "could not check", never "nothing is live".
  if (!Array.isArray(list)) throw new Error("unexpected response shape");
  return list as T[];
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("resume check timed out")), RESUME_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * A check's request never outlives the wait. The axios client has no timeout of
 * its own, and a query left pending would be joined by whoever asks next.
 */
function boundedRequest<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  return withTimeout(request(controller.signal)).finally(() => controller.abort());
}

const liveChapters = (qc: QueryClient) => (subjectId: string, packageSessionId: string) =>
  qc.fetchQuery({
    // Not the viewer's key: its query function also fills a store this skips.
    queryKey: ["resume-live-chapters", subjectId, packageSessionId],
    queryFn: () =>
      boundedRequest((signal) => fetchModulesWithChapters(subjectId, packageSessionId, signal)),
    staleTime: CHECK_STALE_MS,
    retry: false,
  }).then(liveChaptersFrom);

/**
 * Not the lesson's key, so the lesson never joins a check still in flight: it asks
 * for itself. It reads a list the lesson already holds, and is left a finished
 * answer to start from, which spares it the same request.
 */
const liveSlides = (qc: QueryClient) => async (chapterId: string) => {
  const lessonKey = ["slides", chapterId];
  const checkKey = ["resume-live-slides", chapterId];
  const held = qc.getQueryState<Slide[]>(lessonKey);
  if (held?.data && !held.isInvalidated && Date.now() - held.dataUpdatedAt < CHECK_STALE_MS) {
    return asArray<LiveSlide>(held.data);
  }
  const slides = await qc.fetchQuery({
    queryKey: checkKey,
    queryFn: () => boundedRequest((signal) => fetchSlidesByChapterId(chapterId, signal)),
    staleTime: CHECK_STALE_MS,
    retry: false,
  });
  const list = asArray<LiveSlide>(slides);
  qc.setQueryData(lessonKey, slides, { updatedAt: qc.getQueryState(checkKey)?.dataUpdatedAt });
  return list;
};

const enrolledCourses = (qc: QueryClient, instituteId: string) => async () => {
  const queryKey = ["resume-enrolment", instituteId];
  const lookup = await qc.fetchQuery({
    queryKey,
    queryFn: () => boundedRequest((signal) => fetchEnrolmentLookup(instituteId, signal)),
    staleTime: ENROLMENT_STALE_MS,
    retry: false,
  });
  // A partial list answers this visit only.
  if (!lookup.complete) qc.removeQueries({ queryKey, exact: true });
  return lookup;
};

/**
 * The same bounded enrolment read as the resume check, for a caller that needs the
 * answer it leaves behind and not the result. A failure simply leaves no answer.
 */
export function useEnrolmentAsker(instituteId: string | null | undefined): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    if (instituteId) void enrolledCourses(queryClient, instituteId)().catch(() => undefined);
  }, [queryClient, instituteId]);
}

function relativeRulesOf(configs: DripConditionJson[]) {
  return configs
    .flatMap((config) => config.rules ?? [])
    .filter((rule) => rule.type === "relative_date");
}

/**
 * The rules the lesson page will apply, as this device has them: the settings are
 * read from the cached copy, with no request. A day-wise rule also needs its day
 * 1, the same lookup the course pages make, and only while it is not cached.
 */
const dripRules =
  (qc: QueryClient, instituteId: string | null | undefined) =>
  async (courseId: string, packageSessionId: string): Promise<ResumeDripRules> => {
    const settings = await readInstituteDripSettings();
    const store = useDripConditionStore.getState();
    const enforced = settings.enabled
      ? settings.conditions
          .flatMap((c) => (Array.isArray(c.drip_condition) ? c.drip_condition : [c.drip_condition]))
          .map((config) => enforceableCondition(config, settings.applyConfiguredRules))
          .filter((config): config is DripConditionJson => config !== null)
      : [];
    const relative = relativeRulesOf(enforced);
    const needsBatchStart = relative.some(
      (rule) => (rule.params as RelativeDateParams).anchor === "session_start",
    );

    let enrollmentDate = store.enrollmentDates[packageSessionId] ?? null;
    let sessionStartDate: string | null = null;
    if (instituteId && relative.length > 0 && (!enrollmentDate || needsBatchStart)) {
      const anchor = await qc.fetchQuery({
        queryKey: ["resume-drip-anchor", instituteId, packageSessionId],
        queryFn: () => withTimeout(fetchEnrollmentAnchor(instituteId, packageSessionId)),
        staleTime: CHECK_STALE_MS,
        retry: false,
      });
      if (anchor.enrollmentDate) {
        store.setEnrollmentDate(packageSessionId, anchor.enrollmentDate);
        enrollmentDate = anchor.enrollmentDate;
      }
      sessionStartDate = anchor.sessionStartDate;
    }

    const parsed = parseDripCondition(store.getDripCondition(courseId));
    return {
      conditionFor: (level, levelId) =>
        settings.enabled
          ? resolveDripCondition(
              settings.conditions,
              { level, levelId, packageId: courseId },
              { applyConfiguredRules: settings.applyConfiguredRules },
            )
          : null,
      courseCondition: (level) =>
        parsed.success && parsed.data ? getConditionForLevel(parsed.data, level) : null,
      rowLevelEnabled: store.isDrippingEnable,
      enrollmentDate,
      sessionStartDate,
    };
  };

/**
 * The one lesson the dashboard offers to a returning learner.
 *
 * First choice is this device's most recent resume point, once the server has
 * confirmed it is still true. Otherwise a lesson the server lists as in progress,
 * once it has passed the same checks, shown without any claim of being the last
 * one opened. When a check cannot finish, nothing is offered: the Continue
 * Learning list stays as the way back in. `resolving` is true while the answer
 * is unknown, for at most RESUME_WAIT_MS. An answer later than that waits for the
 * next visit: landing now would swap the hero and take the list's button away
 * from a learner already on their way to tapping something.
 *
 * `unanswered` says the slot should not just close: the wait ran out, a check
 * failed, or the slot stood long enough to be aimed around before a "nothing".
 */
export function useDashboardResume({
  serverSlides,
  serverLoading,
  openServerSlide,
  track,
  enabled = true,
}: {
  serverSlides: DashboardSlide[] | undefined;
  serverLoading: boolean;
  openServerSlide: (slide: DashboardSlide) => void;
  track: (event: string, properties?: Record<string, unknown>) => void;
  /** False when nothing on the page would show the answer: no requests, no wait. */
  enabled?: boolean;
}): { target: ResumeTarget | null; resolving: boolean; unanswered: boolean } {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const scope = useResumeScope();
  const owner = scope?.owner;
  const instituteId = scope?.instituteId;

  const candidates = useMemo(() => listResumes(scope).slice(0, MAX_RESUME_CANDIDATES), [scope]);
  const latest = candidates[0];
  const [waitOver, setWaitOver] = useState(false);
  const [slotSeen, setSlotSeen] = useState(false);

  const checks: ResumeChecks = {
    enrolledCourses: enrolledCourses(queryClient, instituteId as string),
    liveChapters: liveChapters(queryClient),
    liveSlides: liveSlides(queryClient),
    dripRules: dripRules(queryClient, instituteId),
    // The lesson count, from answers the check already has: no request of its own.
    // Only a skin's hero shows it. It is worked out whatever the skin, because the
    // skin class can land after this check starts, and keying the check on the
    // skin would restart it after its wait is over and lose the resume point.
    completionThreshold: getSlideCompletionThreshold,
  };

  const device = useQuery({
    queryKey: ["resume-check", owner, instituteId, latest?.slideId, latest?.updatedAt],
    enabled: enabled && Boolean(latest),
    queryFn: (): Promise<VerifiedResume | null> => {
      // These start with the enrolment lookup, so the usual visit takes one round trip.
      void Promise.allSettled([
        checks.liveChapters(latest!.subjectId, latest!.sessionId),
        checks.liveSlides(latest!.chapterId),
      ]);
      return withTimeout(
        verifyResume(candidates, {
          ...checks,
          forget: (courseId) => clearResumeForCourse(scope, courseId),
        }),
      );
    },
    retry: false,
    staleTime: CHECK_STALE_MS,
  });
  const verifiedEntry = latest ? device.data : null;

  const lessons = useMemo(() => serverLessons(serverSlides), [serverSlides]);
  // Only after the device answer is a clean "nothing": if that check could not
  // finish, this one would not either.
  const deviceHasNoAnswer = !latest || (device.isSuccess && !device.data);
  const askServer = Boolean(owner && instituteId) && deviceHasNoAnswer && lessons.length > 0;
  const server = useQuery({
    queryKey: [
      "resume-check-server",
      owner,
      instituteId,
      lessons.map((l) => `${l.slide_id}:${l.package_session_id}`).join(),
    ],
    enabled: enabled && askServer && !waitOver,
    queryFn: () => withTimeout(verifyServerLessons(lessons, checks)),
    retry: false,
    staleTime: CHECK_STALE_MS,
  });

  const resolving =
    enabled &&
    !verifiedEntry &&
    (scope === undefined ||
      (Boolean(latest) && device.isPending) ||
      (deviceHasNoAnswer && (serverLoading || (askServer && server.isPending))));
  useEffect(() => {
    if (!resolving) return;
    const seen = window.setTimeout(() => setSlotSeen(true), SLOT_SEEN_MS);
    const over = window.setTimeout(() => setWaitOver(true), RESUME_WAIT_MS);
    return () => {
      window.clearTimeout(seen);
      window.clearTimeout(over);
    };
  }, [resolving]);

  if (!enabled) return { target: null, resolving: false, unanswered: false };
  if (waitOver) return { target: null, resolving: false, unanswered: true };

  if (verifiedEntry) {
    return {
      resolving: false,
      unanswered: false,
      target: {
        slideId: verifiedEntry.slideId,
        slideTitle: verifiedEntry.slideTitle,
        courseName: verifiedEntry.courseName,
        chapterName: verifiedEntry.chapterName,
        updatedAt: verifiedEntry.updatedAt,
        count: verifiedEntry.count,
        coursePercent: verifiedEntry.coursePercent,
        open: () => {
          track("Resume Learning", {
            slideId: verifiedEntry.slideId,
            slideTitle: verifiedEntry.slideTitle,
            subjectId: verifiedEntry.subjectId,
            moduleId: verifiedEntry.moduleId,
            chapterId: verifiedEntry.chapterId,
          });
          // Loosely typed, as elsewhere: the route validates its own search.
          const to: string = RESUME_ROUTE;
          navigate({ to, search: resumeSearchParams(verifiedEntry) });
        },
      },
    };
  }

  if (resolving) return { target: null, resolving: true, unanswered: false };

  const lesson = askServer ? server.data : null;
  const checkFailed = device.isError || (askServer && server.isError);
  return {
    resolving: false,
    unanswered: !lesson && (checkFailed || slotSeen),
    target: lesson
      ? {
          slideId: lesson.slide.slide_id,
          slideTitle: lesson.slide.slide_title,
          courseName: lesson.courseName,
          count: lesson.count,
          coursePercent: lesson.coursePercent,
          open: () => openServerSlide(lesson.slide),
        }
      : null,
  };
}
