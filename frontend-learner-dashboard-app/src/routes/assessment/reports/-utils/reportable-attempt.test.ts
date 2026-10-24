import { describe, expect, it } from "vitest";
import { isReportableAttempt } from "./reportable-attempt";

/**
 * Surveys used to appear in a learner's report list. `report_release_status` is
 * NULL on every survey attempt, and the release check only excludes the literal
 * "PENDING" — so each one rendered as a RELEASED result worth 0 marks with the
 * "View AI Report" and "Report" buttons enabled. 56 prod attempts were like that.
 */
describe("isReportableAttempt", () => {
  it("drops a survey — it has no marks to report", () => {
    expect(isReportableAttempt({ play_mode: "SURVEY" })).toBe(false);
  });

  it("keeps every type that is actually marked", () => {
    for (const mode of ["EXAM", "MOCK", "PRACTICE", "MANUAL_UPLOAD_EXAM"]) {
      expect(isReportableAttempt({ play_mode: mode })).toBe(true);
    }
  });

  it("keeps a row whose play mode is missing rather than hiding it", () => {
    expect(isReportableAttempt({})).toBe(true);
    expect(isReportableAttempt({ play_mode: undefined })).toBe(true);
  });
});
