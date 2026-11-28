/**
 * Pure state helpers for the CBE (Spreadsheet & Written Response) question
 * slide: the server's attempt shape, the local draft, and which answer to show
 * on load. Kept apart from the component so they can be unit tested.
 *
 * Server: admin_core `CbeAttemptResponse` (snake_case), returned by
 * POST .../question-slide/cbe/submit and GET .../question-slide/cbe/my-attempts.
 */
import type {
  CbeAnswer,
  CbeMarkingLine,
  CbePartContent,
} from "@/components/cbe/types";

export type CbeCriterion = {
  criteria_name?: string;
  marks?: number;
  max_marks?: number;
  reason?: string;
};

export type CbeSlideEvaluation = {
  marks_awarded?: number;
  max_marks?: number;
  /** e.g. CORRECT | PARTIAL | INCORRECT */
  verdict?: string;
  feedback?: string;
  criteria_breakdown?: CbeCriterion[];
};

export type CbeSlideSolutionPart = {
  id: string;
  solution?: CbePartContent | null;
  markingScheme?: CbeMarkingLine[];
};

export type CbeSlideAttempt = {
  slide_id?: string;
  attempt_number?: number | null;
  attempts_used?: number;
  attempts_left?: number;
  max_attempts?: number;
  /** EVALUATED | EVALUATING | EVALUATION_FAILED; null before any submission */
  response_status?: string | null;
  marks?: number | null;
  submitted_at_millis?: number | null;
  answer?: CbeAnswer | null;
  evaluation?: CbeSlideEvaluation | null;
  solution?: { parts?: CbeSlideSolutionPart[] } | null;
  message?: string | null;
  /** NO_CREDITS | EVALUATION_FAILED | UNATTEMPTED */
  error_code?: string | null;
  /** The latest graded check when this attempt has no grade (refused, failed, still running). */
  last_evaluated?: CbeLastEvaluated | null;
};

export type CbeLastEvaluated = {
  attempt_number?: number | null;
  marks?: number | null;
  evaluation?: CbeSlideEvaluation | null;
  submitted_at_millis?: number | null;
};

export type CbeSlideDraft = {
  answer: CbeAnswer;
  /** epoch ms of the last local edit */
  savedAt: number;
};

export const CBE_SLIDE_DRAFT_PREFIX = "cbe_slide_draft_";
export const cbeSlideDraftKey = (slideId: string) => `${CBE_SLIDE_DRAFT_PREFIX}${slideId}`;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** A stored draft, or null when missing / unreadable. */
export function parseCbeSlideDraft(raw: string | null | undefined): CbeSlideDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.answer) || !isRecord(parsed.answer.parts)) return null;
    const savedAt = Number(parsed.savedAt);
    return {
      answer: { parts: parsed.answer.parts as CbeAnswer["parts"] },
      savedAt: Number.isFinite(savedAt) ? savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** True when the attempt carries a usable grade. */
export const hasCbeEvaluation = (attempt: CbeSlideAttempt | null | undefined): boolean =>
  !!attempt?.evaluation && typeof attempt.evaluation === "object" &&
  (attempt.response_status == null || attempt.response_status === "EVALUATED");

/**
 * The attempt to show as "the last result": the attempt itself when it is graded,
 * otherwise its latest graded check (`last_evaluated`), otherwise null. Counts and
 * the solution stay those of the current attempt.
 */
export function cbeResultView(attempt: CbeSlideAttempt | null | undefined): CbeSlideAttempt | null {
  if (!attempt) return null;
  if (hasCbeEvaluation(attempt)) return attempt;
  const last = attempt.last_evaluated;
  if (!last?.evaluation || typeof last.evaluation !== "object") return null;
  return {
    ...attempt,
    attempt_number: last.attempt_number ?? attempt.attempt_number,
    marks: last.marks ?? null,
    evaluation: last.evaluation,
    submitted_at_millis: last.submitted_at_millis ?? null,
    response_status: "EVALUATED",
    message: null,
    error_code: null,
  };
}

/**
 * A new server attempt that carries no grade (402, failed check) keeps the
 * previous graded result, so "Show last result" never disappears because a
 * later check was refused.
 */
export function withPreviousCbeResult(
  previous: CbeSlideAttempt | null | undefined,
  next: CbeSlideAttempt,
): CbeSlideAttempt {
  if (hasCbeEvaluation(next) || next.last_evaluated?.evaluation) return next;
  const prev = cbeResultView(previous);
  if (!prev) return next;
  return {
    ...next,
    last_evaluated: {
      attempt_number: prev.attempt_number ?? null,
      marks: prev.marks ?? null,
      evaluation: prev.evaluation ?? null,
      submitted_at_millis: prev.submitted_at_millis ?? null,
    },
    solution: next.solution ?? prev.solution ?? null,
  };
}

/**
 * The answer to put in the workspace on load: an unsent local draft wins when
 * it is newer than the last submission; otherwise the submitted answer; null
 * means "start from each part's template".
 */
export function pickInitialCbeAnswer(
  draft: CbeSlideDraft | null,
  attempt: CbeSlideAttempt | null,
): { answer: CbeAnswer | null; fromDraft: boolean } {
  const submitted = attempt?.answer && isRecord(attempt.answer.parts) ? attempt.answer : null;
  const submittedAt = Number(attempt?.submitted_at_millis) || 0;
  if (draft && (!submitted || draft.savedAt > submittedAt)) {
    return { answer: draft.answer, fromDraft: true };
  }
  return { answer: submitted, fromDraft: false };
}

/** Badge tone for an evaluation verdict. */
export function cbeVerdictTone(
  verdict: string | undefined,
  marks?: number,
  max?: number,
): "success" | "warning" | "danger" {
  const v = (verdict ?? "").toUpperCase();
  if (v === "CORRECT" || v === "FULL" || v === "PASS") return "success";
  if (v === "PARTIAL" || v === "PARTIALLY_CORRECT" || v === "PARTIAL_CORRECT") return "warning";
  if (v) return "danger";
  if (typeof marks === "number" && typeof max === "number" && max > 0) {
    if (marks >= max) return "success";
    if (marks > 0) return "warning";
  }
  return "danger";
}

/** 13.5 -> "13.5", 13 -> "13", 13.333 -> "13.33" */
export const formatCbeMarks = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "–";
