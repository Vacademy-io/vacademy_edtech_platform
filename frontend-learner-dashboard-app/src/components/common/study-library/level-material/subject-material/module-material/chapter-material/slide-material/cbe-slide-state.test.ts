import { describe, expect, it } from "vitest";
import {
  cbeResultView,
  withPreviousCbeResult,
  cbeSlideDraftKey,
  cbeVerdictTone,
  formatCbeMarks,
  hasCbeEvaluation,
  parseCbeSlideDraft,
  pickInitialCbeAnswer,
  type CbeSlideAttempt,
} from "./cbe-slide-state";
import type { CbeAnswer } from "@/components/cbe/types";

const A = (html: string): CbeAnswer => ({ parts: { p1: { kind: "DOCUMENT", html } } });

describe("parseCbeSlideDraft", () => {
  it("reads a stored draft", () => {
    const raw = JSON.stringify({ answer: A("<p>x</p>"), savedAt: 123 });
    expect(parseCbeSlideDraft(raw)).toEqual({ answer: A("<p>x</p>"), savedAt: 123 });
  });
  it("returns null for missing or corrupt drafts", () => {
    expect(parseCbeSlideDraft(null)).toBeNull();
    expect(parseCbeSlideDraft("{")).toBeNull();
    expect(parseCbeSlideDraft(JSON.stringify({ answer: "x" }))).toBeNull();
  });
  it("keys drafts per slide", () => {
    expect(cbeSlideDraftKey("s1")).not.toBe(cbeSlideDraftKey("s2"));
  });
});

describe("pickInitialCbeAnswer", () => {
  const submitted: CbeSlideAttempt = { answer: A("<p>submitted</p>"), submitted_at_millis: 1000 };

  it("prefers a draft written after the last submission", () => {
    expect(pickInitialCbeAnswer({ answer: A("<p>draft</p>"), savedAt: 2000 }, submitted)).toEqual({
      answer: A("<p>draft</p>"),
      fromDraft: true,
    });
  });
  it("prefers the submitted answer over an older draft", () => {
    expect(pickInitialCbeAnswer({ answer: A("<p>draft</p>"), savedAt: 500 }, submitted)).toEqual({
      answer: A("<p>submitted</p>"),
      fromDraft: false,
    });
  });
  it("uses the draft when nothing was submitted, else starts from the template", () => {
    expect(pickInitialCbeAnswer({ answer: A("<p>d</p>"), savedAt: 1 }, null).fromDraft).toBe(true);
    expect(pickInitialCbeAnswer(null, null)).toEqual({ answer: null, fromDraft: false });
    expect(pickInitialCbeAnswer(null, { attempts_left: 3 })).toEqual({ answer: null, fromDraft: false });
  });
});

describe("result helpers", () => {
  it("hasCbeEvaluation needs an evaluated grade", () => {
    expect(hasCbeEvaluation({ response_status: "EVALUATED", evaluation: { marks_awarded: 3 } })).toBe(true);
    expect(hasCbeEvaluation({ response_status: "EVALUATION_FAILED", evaluation: null })).toBe(false);
    expect(hasCbeEvaluation(null)).toBe(false);
  });
  it("maps verdicts to tones", () => {
    expect(cbeVerdictTone("CORRECT")).toBe("success");
    expect(cbeVerdictTone("partial")).toBe("warning");
    expect(cbeVerdictTone("WRONG")).toBe("danger");
    expect(cbeVerdictTone(undefined, 5, 10)).toBe("warning");
  });
  it("formats marks compactly", () => {
    expect(formatCbeMarks(13.5)).toBe("13.5");
    expect(formatCbeMarks(13)).toBe("13");
    expect(formatCbeMarks(13.3333)).toBe("13.33");
    expect(formatCbeMarks(undefined)).toBe("–");
  });
});

describe("last graded result", () => {
  const graded = {
    attempt_number: 1,
    attempts_left: 2,
    response_status: "EVALUATED",
    marks: 12,
    evaluation: { marks_awarded: 12, max_marks: 20, verdict: "PARTIAL" },
    solution: { parts: [{ id: "p1" }] },
  };

  it("shows the attempt itself when it is graded", () => {
    expect(cbeResultView(graded)).toBe(graded);
    expect(cbeResultView(null)).toBeNull();
  });

  it("falls back to last_evaluated when the latest check failed or was refused", () => {
    const failed = {
      attempt_number: 2,
      attempts_left: 2,
      response_status: "EVALUATION_FAILED",
      error_code: "NO_CREDITS",
      evaluation: null,
      last_evaluated: { attempt_number: 1, marks: 12, evaluation: graded.evaluation, submitted_at_millis: 5 },
    };
    const view = cbeResultView(failed);
    expect(view?.evaluation?.marks_awarded).toBe(12);
    expect(view?.attempt_number).toBe(1);
    expect(view?.attempts_left).toBe(2);
    expect(cbeResultView({ ...failed, last_evaluated: null })).toBeNull();
  });

  it("keeps the previous graded result when a 402 / failed submit comes back", () => {
    const refused = { attempt_number: 2, attempts_left: 2, response_status: "EVALUATION_FAILED", evaluation: null };
    const merged = withPreviousCbeResult(graded, refused);
    expect(merged.last_evaluated?.evaluation?.verdict).toBe("PARTIAL");
    expect(merged.solution?.parts?.[0]?.id).toBe("p1");
    expect(cbeResultView(merged)?.marks).toBe(12);
    // A graded reply, or one that already carries last_evaluated, is used as it is.
    expect(withPreviousCbeResult(refused, graded)).toBe(graded);
    expect(withPreviousCbeResult(null, refused)).toBe(refused);
  });
});
