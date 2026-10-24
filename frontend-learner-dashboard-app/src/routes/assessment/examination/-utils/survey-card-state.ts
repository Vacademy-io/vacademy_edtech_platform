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
export interface CardResultInput {
  play_mode?: string | null;
  /** Nullable on the wire — older rows carry no result type at all. */
  result_type?: string | null;
  report_release_status?: string | null;
}

/** Result types whose report stays hidden until the admin presses Release Result. */
const HELD_UNTIL_RELEASE_RESULT_TYPES = ["MANUAL", "NO_AUTO_RELEASE"];

export const surveyCardState = (
  info: CardResultInput,
  isPast: boolean,
  usedAttempts: number
) => {
  const isSurvey = info.play_mode === "SURVEY";
  const attempted = isPast && usedAttempts > 0;
  // PENDING = held for a teacher on any result type (an uploaded copy, or typed
  // answers the AI is grading); MANUAL and NO_AUTO_RELEASE (auto-marked, but the
  // admin releases by hand) wait for RELEASED.
  const held =
    info.report_release_status === "PENDING" ||
    (HELD_UNTIL_RELEASE_RESULT_TYPES.includes(info.result_type ?? "") &&
      info.report_release_status !== "RELEASED");

  return {
    canShowReport: !isSurvey && attempted && !held,
    resultsPending: !isSurvey && attempted && held,
    surveySubmitted: isSurvey && attempted,
  };
};
