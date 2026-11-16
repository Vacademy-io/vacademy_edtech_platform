import { describe, expect, it } from "vitest";
import { isHeldUntilAssessmentEnd, surveyCardState } from "./survey-card-state";

const past = true;

describe("surveyCardState", () => {
  it("never offers a report on a survey, whatever its result_type", () => {
    for (const result_type of ["MANUAL", "AUTO_AFTER_SUBMISSION", "AUTO_AFTER_ASSESSMENT_END"]) {
      const state = surveyCardState({ play_mode: "SURVEY", result_type }, past, 1);
      expect(state.canShowReport).toBe(false);
      expect(state.resultsPending).toBe(false);
    }
  });

  it("marks a completed survey as submitted instead of leaving the row bare", () => {
    expect(
      surveyCardState({ play_mode: "SURVEY", result_type: "MANUAL" }, past, 1)
        .surveySubmitted
    ).toBe(true);
  });

  it("says nothing about a survey the learner never took", () => {
    const state = surveyCardState({ play_mode: "SURVEY" }, past, 0);
    expect(state.surveySubmitted).toBe(false);
    expect(state.canShowReport).toBe(false);
    expect(state.resultsPending).toBe(false);
  });

  it("still shows the report for an auto-marked exam", () => {
    const state = surveyCardState(
      { play_mode: "EXAM", result_type: "AUTO_AFTER_SUBMISSION" },
      past,
      1
    );
    expect(state.canShowReport).toBe(true);
    expect(state.resultsPending).toBe(false);
    expect(state.surveySubmitted).toBe(false);
  });

  it("still holds a manual exam at pending until it is released", () => {
    const pending = surveyCardState(
      { play_mode: "EXAM", result_type: "MANUAL" },
      past,
      1
    );
    expect(pending.canShowReport).toBe(false);
    expect(pending.resultsPending).toBe(true);

    const released = surveyCardState(
      { play_mode: "EXAM", result_type: "MANUAL", report_release_status: "RELEASED" },
      past,
      1
    );
    expect(released.canShowReport).toBe(true);
    expect(released.resultsPending).toBe(false);
  });

  it("holds a NO_AUTO_RELEASE exam until the admin releases it", () => {
    const unreleased = surveyCardState(
      { play_mode: "EXAM", result_type: "NO_AUTO_RELEASE", report_release_status: null },
      past,
      1
    );
    expect(unreleased.canShowReport).toBe(false);
    expect(unreleased.resultsPending).toBe(true);

    const released = surveyCardState(
      { play_mode: "EXAM", result_type: "NO_AUTO_RELEASE", report_release_status: "RELEASED" },
      past,
      1
    );
    expect(released.canShowReport).toBe(true);
    expect(released.resultsPending).toBe(false);
  });

  it("holds an auto-marked exam that is PENDING for a teacher (AI-graded typed answers)", () => {
    const held = surveyCardState(
      { play_mode: "EXAM", result_type: "AUTO_AFTER_SUBMISSION", report_release_status: "PENDING" },
      past,
      1
    );
    expect(held.canShowReport).toBe(false);
    expect(held.resultsPending).toBe(true);

    const released = surveyCardState(
      { play_mode: "EXAM", result_type: "AUTO_AFTER_SUBMISSION", report_release_status: "RELEASED" },
      past,
      1
    );
    expect(released.canShowReport).toBe(true);
    expect(released.resultsPending).toBe(false);
  });

  it("offers nothing on an assessment that is not past yet", () => {
    const state = surveyCardState(
      { play_mode: "EXAM", result_type: "AUTO_AFTER_SUBMISSION" },
      false,
      1
    );
    expect(state.canShowReport).toBe(false);
    expect(state.resultsPending).toBe(false);
  });
  describe("AUTO_AFTER_ASSESSMENT_END", () => {
    // Backend dates come without a zone marker and are UTC.
    const end = "2026-11-20T12:30:00";
    const endMs = Date.UTC(2026, 10, 20, 12, 30, 0);
    const exam = {
      play_mode: "EXAM",
      result_type: "AUTO_AFTER_ASSESSMENT_END",
      report_release_status: null,
      bound_end_time: end,
    };

    it("holds the result of a learner who submitted before the end date", () => {
      const state = surveyCardState(exam, past, 1, endMs - 60_000);
      expect(state.canShowReport).toBe(false);
      expect(state.resultsPending).toBe(true);
    });

    it("shows it once the end date has passed, before the hourly release job runs", () => {
      const state = surveyCardState(exam, past, 1, endMs + 1000);
      expect(state.canShowReport).toBe(true);
      expect(state.resultsPending).toBe(false);
    });

    it("shows it once released, even before the end date", () => {
      const state = surveyCardState(
        { ...exam, report_release_status: "RELEASED" },
        past,
        1,
        endMs - 60_000
      );
      expect(state.canShowReport).toBe(true);
    });

    it("keeps a PENDING attempt held after the end date", () => {
      const state = surveyCardState(
        { ...exam, report_release_status: "PENDING" },
        past,
        1,
        endMs + 1000
      );
      expect(state.resultsPending).toBe(true);
    });

    it("never holds mock or practice tests, which release on submission", () => {
      for (const play_mode of ["MOCK", "PRACTICE", "practice"]) {
        expect(isHeldUntilAssessmentEnd({ ...exam, play_mode }, endMs - 60_000)).toBe(false);
      }
    });

    it("does not hold forever when the end date is missing or the 9999 sentinel", () => {
      expect(isHeldUntilAssessmentEnd({ ...exam, bound_end_time: null }, endMs)).toBe(false);
      expect(
        isHeldUntilAssessmentEnd({ ...exam, bound_end_time: "9999-12-31T23:59:59" }, endMs)
      ).toBe(false);
    });

    it("leaves AUTO_AFTER_SUBMISSION alone before the end date", () => {
      expect(
        isHeldUntilAssessmentEnd({ ...exam, result_type: "AUTO_AFTER_SUBMISSION" }, endMs - 60_000)
      ).toBe(false);
    });
  });
});
