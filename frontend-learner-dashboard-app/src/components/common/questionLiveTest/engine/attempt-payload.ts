/**
 * The attempt payload sent by the 60 s autosave (status LIVE) and by submit
 * (status END). One builder for both, so time values cannot drift between them
 * again: submit used to send the section time left in milliseconds and the
 * section elapsed time with the wrong sign.
 */
import {
  encodeQuestionResponse,
  type StoreAnswerMaps,
} from "@/lib/assessment-response";
import type { AssessmentPreviewData } from "@/types/assessment";

/** The slice of the assessment store the payload reads. */
export interface AttemptPayloadState extends StoreAnswerMaps {
  assessment: Pick<
    AssessmentPreviewData,
    "attempt_id" | "duration" | "section_dtos"
  > | null;
  entireTestTimer: number;
  tabSwitchCount: number;
  sectionTimers: Record<number, { timeLeft: number } | undefined>;
  questionTimers: Record<string, number>;
  questionTimeSpent: Record<string, number>;
  questionStates: Record<
    string,
    { isMarkedForReview?: boolean; isVisited?: boolean } | undefined
  >;
}

export interface SubmitPayloadOptions {
  evaluationType: string;
  /** Uploaded answer-sheet file id ("" when none). */
  fileId: string;
  /** A MANUAL attempt with an uploaded PDF sends only on-screen answers. */
  hasPdf: boolean;
}

export interface AttemptPayloadOptions {
  assessmentId: string;
  status: string;
  /** Server start time in ms (0 when unknown). */
  startTimeMs: number;
  nowMs: number;
  /** Present for the final submit; absent for the autosave. */
  submit?: SubmitPayloadOptions;
}

/** Whole-test elapsed seconds. */
export function attemptElapsedSeconds(
  durationMinutes: number | undefined,
  entireTestTimer: number,
  startTimeMs: number,
  nowMs: number,
): number {
  // With a clock, elapsed = duration - remaining. Without one (practice,
  // survey) count from the server start time, so the report's "time taken"
  // is real instead of 0.
  if (durationMinutes) return durationMinutes * 60 - entireTestTimer;
  if (startTimeMs > 0) {
    return Math.max(0, Math.round((nowMs - startTimeMs) / 1000));
  }
  return 0;
}

/** Section time left and elapsed, both in whole seconds. */
export function sectionTimeValues(
  timeLeftMs: number | undefined,
  sectionDurationMinutes: number | undefined,
): { leftSeconds: number; elapsedSeconds: number } {
  const leftSeconds = Math.round((timeLeftMs || 0) / 1000);
  return {
    leftSeconds,
    elapsedSeconds: sectionDurationMinutes
      ? sectionDurationMinutes * 60 - leftSeconds
      : 0,
  };
}

export function buildAttemptPayload(
  state: AttemptPayloadState,
  options: AttemptPayloadOptions,
) {
  const { submit } = options;
  const timeElapsedInSeconds = attemptElapsedSeconds(
    state.assessment?.duration,
    state.entireTestTimer,
    options.startTimeMs,
    options.nowMs,
  );
  const clientLastSync = new Date(
    options.startTimeMs + timeElapsedInSeconds * 1000,
  ).toISOString();

  return {
    attemptId: state.assessment?.attempt_id,
    ...(submit?.evaluationType === "MANUAL" && {
      fileId: submit.fileId,
      setId: "ggcgc",
    }),
    clientLastSync,
    assessment: {
      assessmentId: options.assessmentId,
      entireTestDurationLeftInSeconds: state.entireTestTimer,
      timeElapsedInSeconds,
      status: options.status,
      tabSwitchCount: state.tabSwitchCount || 0,
    },
    sections: state.assessment?.section_dtos?.map((section, idx) => {
      const { leftSeconds, elapsedSeconds } = sectionTimeValues(
        state.sectionTimers?.[idx]?.timeLeft,
        section.duration,
      );
      return {
        sectionId: section.id,
        sectionDurationLeftInSeconds: leftSeconds,
        timeElapsedInSeconds: elapsedSeconds,
        questions: section.question_preview_dto_list?.map((question) => {
          const baseQuestionData = {
            questionId: question.question_id,
            questionDurationLeftInSeconds:
              state.questionTimers?.[question.question_id] || 0,
            timeTakenInSeconds:
              state.questionTimeSpent[question.question_id] || 0,
            isMarkedForReview:
              state.questionStates[question.question_id]?.isMarkedForReview ||
              false,
            isVisited:
              state.questionStates[question.question_id]?.isVisited || false,
          };

          // The autosave always sends the response. The submit sends it
          // whenever the attempt is AUTO, or MANUAL with no PDF (for example a
          // CODING-only test). CODING and CBE answers exist only on screen,
          // never on the uploaded paper, so they always go; leaving them out
          // would overwrite the autosaved attempt with no answer.
          const includeResponse =
            !submit ||
            submit.evaluationType !== "MANUAL" ||
            !submit.hasPdf ||
            question.question_type === "CODING" ||
            question.question_type === "CBE_RESPONSE";
          if (!includeResponse) return baseQuestionData;

          // One encoder for every type (lib/assessment-response.ts), shared
          // with the restart payload.
          const responseData = encodeQuestionResponse(question, state);
          return { ...baseQuestionData, responseData };
        }),
      };
    }),
  };
}
