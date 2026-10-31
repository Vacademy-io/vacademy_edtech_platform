/**
 * A survey collects opinions, not marks — there is nothing to report.
 *
 * Surveys were still listed among a learner's reports, and because
 * `report_release_status` is NULL on every survey attempt (while the release
 * check only excludes the literal "PENDING"), each one rendered as a RELEASED
 * result worth 0 marks with the report buttons enabled. 56 prod attempts were
 * in that state.
 *
 * Anything whose play mode is unknown is kept: hiding a real result is worse
 * than showing a survey.
 */
export const isReportableAttempt = (report: { play_mode?: string }) =>
  report.play_mode !== "SURVEY";
