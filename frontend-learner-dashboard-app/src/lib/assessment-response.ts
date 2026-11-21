/**
 * One definition of the saved-answer wire shape, used by both directions.
 *
 * The live-test autosave and the restart/resume restore used to encode and
 * decode this independently, and they disagreed: the save path wrote NUMERIC as
 * `validAnswer`, ONE_WORD/LONG_ANSWER as `answer` and CODING as a full payload,
 * while the restore path read only `optionIds`. Every non-MCQ answer therefore
 * came back empty on resume — the learner's text was gone, the navigator showed
 * "Not Visited", and the submit summary counted the question unattempted.
 *
 * Keep encode and decode in this file so the two can never drift again.
 */

import type {
  CodingAnswerData,
  CodingTestCaseResult,
} from "@/stores/assessment-store";
import {
  CBE_QUESTION_TYPE,
  isCbeAnswerEmpty,
  type CbeAnswer,
  type CbeConfig,
} from "@/components/cbe/types";

/** The store's coding answer shape — reused so restore can't drift from it. */
export type CodingResponsePayload = CodingAnswerData;

export interface ResponseData {
  type: string;
  optionIds?: string[];
  /** ONE_WORD / LONG_ANSWER: the text. CBE_RESPONSE: `{ parts }` (contract §4). */
  answer?: string | CbeAnswer;
  validAnswer?: number | null;
  language?: string;
  sourceCode?: string;
  verdict?: string;
  passedCount?: number;
  totalCount?: number;
  score?: number;
  totalTimeMs?: number;
  peakMemoryKb?: number;
  testCaseResults?: CodingTestCaseResult[];
  pasteAttemptCount?: number;
}

/** The store's CBE answer for one question, plus its blocked-paste counter. */
export interface CbeResponseInput {
  answer?: CbeAnswer | null;
  pasteAttemptCount?: number;
}

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || String(value).trim() === "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Store answer -> wire payload.
 *
 * CBE_RESPONSE is sent as `{ type, answer: { parts } }` (contract §4) even when
 * it is over the 300 KB cap: the workspace warns, but the answer is never
 * dropped. `pasteAttemptCount` rides along like CODING's; the backend DTO
 * ignores fields it does not know.
 */
export const encodeResponseData = (
  questionType: string,
  rawAnswer: string[] | undefined,
  codingAnswer?: Partial<CodingResponsePayload>,
  cbe?: CbeResponseInput
): ResponseData => {
  const normalizedAnswer = Array.isArray(rawAnswer) ? rawAnswer[0] : rawAnswer;

  if (questionType === CBE_QUESTION_TYPE) {
    const rawParts = cbe?.answer?.parts;
    const parts: CbeAnswer["parts"] = isRecord(rawParts) ? rawParts : {};
    return {
      type: CBE_QUESTION_TYPE,
      answer: { parts },
      pasteAttemptCount: cbe?.pasteAttemptCount ?? 0,
    };
  }

  if (questionType === "CODING") {
    return {
      type: "CODING",
      language: codingAnswer?.language || "",
      sourceCode: codingAnswer?.sourceCode || "",
      verdict: codingAnswer?.verdict || "",
      passedCount: codingAnswer?.passedCount ?? 0,
      totalCount: codingAnswer?.totalCount ?? 0,
      score: codingAnswer?.score ?? 0,
      totalTimeMs: codingAnswer?.totalTimeMs ?? 0,
      peakMemoryKb: codingAnswer?.peakMemoryKb ?? 0,
      testCaseResults: codingAnswer?.testCaseResults ?? [],
      pasteAttemptCount: codingAnswer?.pasteAttemptCount ?? 0,
    };
  }

  if (questionType === "NUMERIC") {
    const parsed =
      normalizedAnswer !== undefined &&
      normalizedAnswer !== null &&
      !isNaN(parseFloat(normalizedAnswer))
        ? parseFloat(normalizedAnswer)
        : null;
    return { type: "NUMERIC", validAnswer: parsed };
  }

  if (questionType === "ONE_WORD" || questionType === "LONG_ANSWER") {
    return { type: questionType, answer: normalizedAnswer || "" };
  }

  return { type: questionType, optionIds: rawAnswer || [] };
};

/** Wire payload -> store `answers` entry. */
export const decodeAnswer = (responseData?: ResponseData): string[] => {
  if (!responseData) return [];

  switch (responseData.type) {
    case "NUMERIC":
      return isBlank(responseData.validAnswer)
        ? []
        : [String(responseData.validAnswer)];
    case "ONE_WORD":
    case "LONG_ANSWER":
      return typeof responseData.answer === "string" && responseData.answer
        ? [responseData.answer]
        : [];
    case "CODING":
      // Coding answers live in `codingAnswers`, not `answers`.
      return [];
    case CBE_QUESTION_TYPE:
      // CBE answers live in `cbeAnswers`, not `answers`.
      return [];
    default:
      return responseData.optionIds ?? [];
  }
};

/** Wire payload -> store `codingAnswers` entry, or null for non-coding types. */
export const decodeCodingAnswer = (
  responseData?: ResponseData
): CodingResponsePayload | null => {
  if (!responseData || responseData.type !== "CODING") return null;
  return {
    language: responseData.language || "",
    sourceCode: responseData.sourceCode || "",
    verdict: responseData.verdict || "",
    passedCount: responseData.passedCount ?? 0,
    totalCount: responseData.totalCount ?? 0,
    score: responseData.score ?? 0,
    totalTimeMs: responseData.totalTimeMs ?? 0,
    peakMemoryKb: responseData.peakMemoryKb ?? 0,
    testCaseResults: responseData.testCaseResults ?? [],
    pasteAttemptCount: responseData.pasteAttemptCount ?? 0,
  };
};

/** Wire payload -> store `cbeAnswers` entry, or null for non-CBE types. */
export const decodeCbeAnswer = (responseData?: ResponseData): CbeAnswer | null => {
  if (!responseData || responseData.type !== CBE_QUESTION_TYPE) return null;
  const answer = responseData.answer;
  if (!isRecord(answer) || !isRecord(answer.parts)) return { parts: {} };
  return { parts: answer.parts as CbeAnswer["parts"] };
};

/** Wire payload -> the CBE blocked-paste counter (0 for other types). */
export const decodeCbePasteAttempts = (responseData?: ResponseData): number =>
  responseData?.type === CBE_QUESTION_TYPE
    ? Number(responseData.pasteAttemptCount) || 0
    : 0;

/**
 * Whether a decoded response actually carries an answer. For CBE pass the
 * question's config so content identical to the template does not count.
 */
export const responseHasAnswer = (
  responseData?: ResponseData,
  cbeConfig?: CbeConfig | null
): boolean => {
  const cbe = decodeCbeAnswer(responseData);
  if (cbe) return !isCbeAnswerEmpty(cbe, cbeConfig);
  const coding = decodeCodingAnswer(responseData);
  if (coding) return coding.sourceCode.trim().length > 0;
  return decodeAnswer(responseData).some((value) => !isBlank(value));
};

/** The slice of the assessment store the encoders read. */
export interface StoreAnswerMaps {
  answers?: Record<string, string[]>;
  codingAnswers?: Record<string, CodingResponsePayload>;
  cbeAnswers?: Record<string, CbeAnswer>;
  cbePasteAttempts?: Record<string, number>;
}

/**
 * One question's `responseData` from the store. The live-test autosave, the
 * submit and the restart all go through this, so a new question type is
 * encoded in exactly one place (an unknown type used to fall into an
 * `optionIds` branch and silently lose its answer).
 */
export const encodeQuestionResponse = (
  question: { question_id: string; question_type: string },
  maps: StoreAnswerMaps
): ResponseData =>
  encodeResponseData(
    question.question_type,
    maps.answers?.[question.question_id],
    maps.codingAnswers?.[question.question_id],
    {
      answer: maps.cbeAnswers?.[question.question_id],
      pasteAttemptCount: maps.cbePasteAttempts?.[question.question_id],
    }
  );
