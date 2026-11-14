import { useCallback, useSyncExternalStore } from "react";
import { answeredEnrolments, subscribeToEnrolmentAnswers } from "@/services/enrolled-courses";
import { useCurrentInstituteId } from "@/services/points";
import {
  furthestUnfinishedPercent,
  standingOf,
  type EnrolledStanding,
} from "@/lib/learner-state/course-progress";

const nothingToHear = () => () => {};

/** One fact out of this visit's enrolment answers, with no request of its own. */
function useEnrolmentFact<T extends string | number | null | undefined>(
  on: boolean,
  fact: (instituteId: string | null | undefined) => T,
  fallback: T,
): T {
  const instituteId = useCurrentInstituteId();
  const read = useCallback(() => fact(instituteId), [fact, instituteId]);
  return useSyncExternalStore(on ? subscribeToEnrolmentAnswers : nothingToHear, read, () => fallback);
}

const standingFact = (instituteId: string | null | undefined): EnrolledStanding =>
  instituteId ? standingOf(answeredEnrolments(instituteId)) : "unknown";

const furthestFact = (instituteId: string | null | undefined): number | null | undefined => {
  const rows = instituteId ? answeredEnrolments(instituteId) : null;
  return rows ? furthestUnfinishedPercent(rows) : undefined;
};

/**
 * What the enrolment answers on the page say (no courses, all finished, ...). The
 * course widget and the first-run check fill them, the resume check and the course
 * pages too. Follows them as they land, since the widget's usually lands after the
 * hero has drawn. "unknown" until an answer exists; it never asks by itself.
 */
export const useEnrolledStanding = (on = true): EnrolledStanding =>
  useEnrolmentFact<EnrolledStanding>(on, standingFact, "unknown");

/** The furthest unfinished course percent, for when there is no resume point. Undefined until answered. */
export const useEnrolledFurthestPercent = (on = true): number | null | undefined =>
  useEnrolmentFact<number | null | undefined>(on, furthestFact, undefined);
