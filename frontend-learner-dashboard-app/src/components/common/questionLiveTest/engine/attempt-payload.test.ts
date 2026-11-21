import { describe, expect, it } from "vitest";
import {
  attemptElapsedSeconds,
  buildAttemptPayload,
  sectionTimeValues,
  type AttemptPayloadState,
} from "./attempt-payload";

const START = Date.UTC(2026, 10, 12, 4, 0, 0);

const question = (id: string, type: string) => ({
  question_id: id,
  question_type: type,
});

const state = (): AttemptPayloadState => ({
  assessment: {
    attempt_id: "att-1",
    duration: 60,
    section_dtos: [
      {
        id: "s1",
        duration: 30,
        question_preview_dto_list: [
          question("q1", "MCQS"),
          question("q2", "CODING"),
        ],
      },
      {
        id: "s2",
        duration: 0,
        question_preview_dto_list: [question("q3", "NUMERIC")],
      },
    ] as never,
  },
  entireTestTimer: 3000,
  tabSwitchCount: 1,
  // 25 min 30 s left in section 1.
  sectionTimers: { 0: { timeLeft: 1_530_000 }, 1: { timeLeft: 0 } },
  questionTimers: { q1: 0 },
  questionTimeSpent: { q1: 42 },
  questionStates: { q1: { isVisited: true, isMarkedForReview: true } },
  answers: { q1: ["o2"], q3: ["7.5"] },
  codingAnswers: {},
  cbeAnswers: {},
});

describe("time values", () => {
  it("whole-test elapsed is duration minus remaining when there is a clock", () => {
    expect(attemptElapsedSeconds(60, 3000, START, START + 999_000)).toBe(600);
  });
  it("whole-test elapsed counts from the server start without a clock", () => {
    expect(attemptElapsedSeconds(0, 0, START, START + 90_400)).toBe(90);
    expect(attemptElapsedSeconds(undefined, 0, 0, START)).toBe(0);
  });
  it("section values are whole seconds, elapsed = duration - left", () => {
    expect(sectionTimeValues(1_530_000, 30)).toEqual({
      leftSeconds: 1530,
      elapsedSeconds: 270,
    });
    expect(sectionTimeValues(undefined, 30)).toEqual({
      leftSeconds: 0,
      elapsedSeconds: 1800,
    });
    expect(sectionTimeValues(5000, 0)).toEqual({ leftSeconds: 5, elapsedSeconds: 0 });
  });
});

describe("buildAttemptPayload", () => {
  it("autosave: seconds, positive elapsed, every response", () => {
    const payload = buildAttemptPayload(state(), {
      assessmentId: "a-1",
      status: "LIVE",
      startTimeMs: START,
      nowMs: START,
    });
    expect(payload).toMatchObject({
      attemptId: "att-1",
      clientLastSync: new Date(START + 600_000).toISOString(),
      assessment: {
        assessmentId: "a-1",
        entireTestDurationLeftInSeconds: 3000,
        timeElapsedInSeconds: 600,
        status: "LIVE",
        tabSwitchCount: 1,
      },
    });
    expect(payload).not.toHaveProperty("fileId");
    const [s1, s2] = payload.sections ?? [];
    expect(s1.sectionDurationLeftInSeconds).toBe(1530);
    expect(s1.timeElapsedInSeconds).toBe(270);
    expect(s2.sectionDurationLeftInSeconds).toBe(0);
    expect(s2.timeElapsedInSeconds).toBe(0);
    expect(s1.questions?.[0]).toMatchObject({
      questionId: "q1",
      questionDurationLeftInSeconds: 0,
      timeTakenInSeconds: 42,
      isMarkedForReview: true,
      isVisited: true,
      responseData: { type: "MCQS", optionIds: ["o2"] },
    });
    expect(s2.questions?.[0]).toHaveProperty("responseData");
  });

  it("submit sends the same section seconds as autosave (was ms with the wrong sign)", () => {
    const live = buildAttemptPayload(state(), {
      assessmentId: "a-1",
      status: "LIVE",
      startTimeMs: START,
      nowMs: START,
    });
    const end = buildAttemptPayload(state(), {
      assessmentId: "a-1",
      status: "END",
      startTimeMs: START,
      nowMs: START,
      submit: { evaluationType: "AUTO", fileId: "", hasPdf: false },
    });
    expect(end.sections).toEqual(live.sections);
    expect(end.assessment.status).toBe("END");
    expect(end).not.toHaveProperty("fileId");
  });

  it("MANUAL with a PDF adds the file and sends only on-screen answers", () => {
    const payload = buildAttemptPayload(state(), {
      assessmentId: "a-1",
      status: "END",
      startTimeMs: START,
      nowMs: START,
      submit: { evaluationType: "MANUAL", fileId: "f-9", hasPdf: true },
    });
    expect(payload).toMatchObject({ fileId: "f-9", setId: "ggcgc" });
    const questions = payload.sections?.[0].questions ?? [];
    expect(questions[0]).not.toHaveProperty("responseData");
    expect(questions[1]).toHaveProperty("responseData");
    expect(payload.sections?.[1].questions?.[0]).not.toHaveProperty("responseData");
  });

  it("MANUAL without a PDF still sends every response", () => {
    const payload = buildAttemptPayload(state(), {
      assessmentId: "a-1",
      status: "END",
      startTimeMs: START,
      nowMs: START,
      submit: { evaluationType: "MANUAL", fileId: "", hasPdf: false },
    });
    expect(payload).toMatchObject({ fileId: "", setId: "ggcgc" });
    expect(payload.sections?.[0].questions?.[0]).toHaveProperty("responseData");
  });
});
