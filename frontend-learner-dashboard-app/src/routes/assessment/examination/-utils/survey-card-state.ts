/**
 * What a finished assessment card offers the learner.
 *
 * A survey has no marks, so it has neither a report to open nor a result to
 * wait for — but both of the original flags keyed off `result_type`, which on a
 * survey is incidental. The 147 older surveys carry MANUAL (so they showed
 * "Results pending" forever), while a survey created today defaults to
 * AUTO_AFTER_SUBMISSION and would have offered "Show Report" and
 * "Show AI Report" on an unmarked questionnaire.
 */
import { hasNoExpiry, toUtcDate } from "@/utils/assessment-window";

export interface CardResultInput {
  play_mode?: string | null;
  /** Nullable on the wire — older rows carry no result type at all. */
  result_type?: string | null;
  report_release_status?: string | null;
  /** UTC, no zone marker on the wire. Drives AUTO_AFTER_ASSESSMENT_END. */
  bound_end_time?: string | null;
}

/** Result types whose report stays hidden until the admin presses Release Result. */
const HELD_UNTIL_RELEASE_RESULT_TYPES = ["MANUAL", "NO_AUTO_RELEASE"];

/**
 * Mock and practice tests never end (their window closes in 9999), so the
 * backend releases them on submission even when "after the assessment ends"
 * is chosen. Mirrors StudentAttemptService.OPEN_ENDED_PLAY_MODES.
 */
const OPEN_ENDED_PLAY_MODES = ["MOCK", "PRACTICE"];

/**
 * AUTO_AFTER_ASSESSMENT_END: a learner who submits before the end date must not
 * see the result until the window closes. The attempt carries no release status
 * until the hourly job marks it RELEASED, so the end date itself is the gate.
 * Same rule as LearnerReportService.isHeldUntilAssessmentEnd.
 */
export const isHeldUntilAssessmentEnd = (
  info: CardResultInput,
  now: number = Date.now()
): boolean => {
  if (info.result_type !== "AUTO_AFTER_ASSESSMENT_END") return false;
  if (info.report_release_status === "RELEASED") return false;
  if (OPEN_ENDED_PLAY_MODES.includes((info.play_mode ?? "").toUpperCase())) {
    return false;
  }
  const end = toUtcDate(info.bound_end_time);
  // No usable end date: there is nothing to wait for, so do not hold forever.
  if (!end || hasNoExpiry(end)) return false;
  return now <= end.getTime();
};

export const surveyCardState = (
  info: CardResultInput,
  isPast: boolean,
  usedAttempts: number,
  now: number = Date.now()
) => {
  const isSurvey = info.play_mode === "SURVEY";
  const attempted = isPast && usedAttempts > 0;
  // PENDING = held for a teacher on any result type (an uploaded copy, or typed
  // answers the AI is grading); MANUAL and NO_AUTO_RELEASE (auto-marked, but the
  // admin releases by hand) wait for RELEASED; AUTO_AFTER_ASSESSMENT_END
  // waits for the end date.
  const held =
    info.report_release_status === "PENDING" ||
    (HELD_UNTIL_RELEASE_RESULT_TYPES.includes(info.result_type ?? "") &&
      info.report_release_status !== "RELEASED") ||
    isHeldUntilAssessmentEnd(info, now);

  return {
    canShowReport: !isSurvey && attempted && !held,
    resultsPending: !isSurvey && attempted && held,
    surveySubmitted: isSurvey && attempted,
  };
};
