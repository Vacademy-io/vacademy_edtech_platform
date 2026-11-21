/**
 * Spreadsheet & Written Response (CBE_RESPONSE) questions inside a quiz slide: pure
 * helpers shared by the quiz viewer and the quiz review. Kept apart from the
 * components so they can be unit tested.
 *
 * In the quiz the answer is kept in the viewer's answers map as JSON text (the map
 * holds strings, numbers and id lists, and is saved to localStorage as it is). The
 * quiz submit sends it with 0 marks; the server records it as waiting for its AI
 * check, and POST .../quiz-slide/cbe/grade marks it afterwards. The recorded row
 * (`response_json`) is then `{type, answer, evaluation, marks, maxMarks, cbeState, ...}`.
 */
import {
  CBE_QUESTION_TYPE,
  isCbeAnswerEmpty,
  type CbeAnswer,
  type CbeConfig,
} from "@/components/cbe/types";
import type { CbeSlideEvaluation } from "./cbe-slide-state";

export type QuizCbeState =
  | "PENDING"
  | "EVALUATING"
  | "EVALUATED"
  | "FAILED"
  | "SKIPPED"
  | "UNATTEMPTED"
  | "NO_CHECKS_LEFT";

/** A CBE question's recorded row in a quiz attempt, as the server writes it. */
export type QuizCbeRow = {
  answer?: CbeAnswer | null;
  evaluation?: CbeSlideEvaluation | null;
  marks?: number;
  maxMarks?: number;
  isCorrect?: boolean;
  isPartial?: boolean;
  cbeState?: QuizCbeState;
  error?: string;
};

export const isCbeQuizQuestion = (question: { question_type?: string } | null | undefined): boolean =>
  question?.question_type === CBE_QUESTION_TYPE;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The answer from the answers map (JSON text) or from a recorded row; null when there is none. */
export function parseCbeQuizAnswer(value: unknown): CbeAnswer | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (!value.trim().startsWith("{")) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return isRecord(parsed) && isRecord(parsed.parts) ? (parsed as unknown as CbeAnswer) : null;
}

/** What the answers map keeps: JSON text, or undefined while nothing beyond the template is written. */
export function serializeCbeQuizAnswer(
  answer: CbeAnswer | null | undefined,
  config: CbeConfig | null,
): string | undefined {
  if (!answer || isCbeAnswerEmpty(answer, config)) return undefined;
  return JSON.stringify(answer);
}

/**
 * The response_json a quiz submit sends for a CBE question. It claims no marks: the
 * server records the answer and marks it with its AI check.
 */
export function cbeQuizResponseJson(questionName: string, value: unknown, maxMarks: number): string {
  return JSON.stringify({
    questionName,
    questionType: CBE_QUESTION_TYPE,
    type: CBE_QUESTION_TYPE,
    answer: parseCbeQuizAnswer(value),
    marks: 0,
    maxMarks,
  });
}

/** A recorded CBE row; null for anything else (another question type, unreadable JSON). */
export function parseCbeRow(responseJson: string | null | undefined): QuizCbeRow | null {
  if (!responseJson) return null;
  try {
    const parsed: unknown = JSON.parse(responseJson);
    if (!isRecord(parsed) || parsed.type !== CBE_QUESTION_TYPE) return null;
    return {
      answer: parseCbeQuizAnswer(parsed.answer),
      evaluation: isRecord(parsed.evaluation) ? (parsed.evaluation as CbeSlideEvaluation) : null,
      marks: typeof parsed.marks === "number" ? parsed.marks : undefined,
      maxMarks: typeof parsed.maxMarks === "number" ? parsed.maxMarks : undefined,
      isCorrect: parsed.isCorrect === true,
      isPartial: parsed.isPartial === true,
      cbeState: typeof parsed.cbeState === "string" ? (parsed.cbeState as QuizCbeState) : undefined,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return null;
  }
}

/** Still waiting for marks: the review shows "being checked" and the score does not count it as wrong. */
export const isCbeAwaitingMarks = (state: QuizCbeState | undefined): boolean =>
  state === "PENDING" || state === "EVALUATING" || state === "FAILED";

/** Asking the server to grade again could change these (a check that failed or never ran). */
export const cbeStateWantsGrading = (state: QuizCbeState | undefined): boolean =>
  state === "PENDING" || state === "FAILED";

/** How a CBE question counts in the review's correct / partial / wrong tallies. */
export function cbeReviewStatus(
  row: QuizCbeRow | null,
  answered: boolean,
): "correct" | "partial" | "wrong" | "skipped" | "pending" {
  if (row?.cbeState === "SKIPPED" || row?.cbeState === "UNATTEMPTED") return "skipped";
  if (!row) return answered ? "pending" : "skipped";
  if (isCbeAwaitingMarks(row.cbeState) || row.cbeState === "NO_CHECKS_LEFT") {
    return row.cbeState === "NO_CHECKS_LEFT" ? "wrong" : "pending";
  }
  if (row.isCorrect) return "correct";
  if (row.isPartial || (row.marks ?? 0) > 0) return "partial";
  return answered || row.answer ? "wrong" : "skipped";
}
