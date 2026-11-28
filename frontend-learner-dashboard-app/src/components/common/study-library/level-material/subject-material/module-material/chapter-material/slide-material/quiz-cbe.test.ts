import { describe, expect, it } from "vitest";
import type { CbeConfig } from "@/components/cbe/types";
import {
  cbeQuizResponseJson,
  cbeReviewStatus,
  cbeStateWantsGrading,
  isCbeQuizQuestion,
  parseCbeQuizAnswer,
  parseCbeRow,
  serializeCbeQuizAnswer,
} from "./quiz-cbe";

const config: CbeConfig = {
  type: "CBE_RESPONSE",
  data: {
    version: 1,
    parts: [
      {
        id: "p_a",
        label: "(a)",
        kind: "SPREADSHEET",
        marks: 10,
        template: { sheet: { sheets: [{ name: "S", cells: { A1: { v: "Goodwill" } } }] } },
      },
    ],
  },
} as CbeConfig;

const written = { parts: { p_a: { kind: "SPREADSHEET" as const, sheet: { sheets: [{ name: "S", cells: { A1: { v: "Goodwill" }, B1: { v: 3200 } } }] } } } };
const templateOnly = { parts: { p_a: { kind: "SPREADSHEET" as const, sheet: { sheets: [{ name: "S", cells: { A1: { v: "Goodwill" } } }] } } } };

describe("quiz CBE answers", () => {
  it("keeps a written answer as JSON text and nothing for the template alone", () => {
    const text = serializeCbeQuizAnswer(written, config);
    expect(typeof text).toBe("string");
    expect(parseCbeQuizAnswer(text)).toEqual(written);
    expect(serializeCbeQuizAnswer(templateOnly, config)).toBeUndefined();
    expect(serializeCbeQuizAnswer(null, config)).toBeUndefined();
  });

  it("reads an answer from JSON text or an object, and nothing else", () => {
    expect(parseCbeQuizAnswer(written)).toEqual(written);
    expect(parseCbeQuizAnswer("opt-1")).toBeNull();
    expect(parseCbeQuizAnswer("{broken")).toBeNull();
    expect(parseCbeQuizAnswer(42)).toBeNull();
  });

  it("sends the answer with no marks claimed", () => {
    const json = JSON.parse(cbeQuizResponseJson("<p>SFP</p>", JSON.stringify(written), 10));
    expect(json.type).toBe("CBE_RESPONSE");
    expect(json.questionType).toBe("CBE_RESPONSE");
    expect(json.answer).toEqual(written);
    expect(json.marks).toBe(0);
    expect(json.maxMarks).toBe(10);
    expect(json.isCorrect).toBeUndefined();
  });

  it("recognises CBE questions", () => {
    expect(isCbeQuizQuestion({ question_type: "CBE_RESPONSE" })).toBe(true);
    expect(isCbeQuizQuestion({ question_type: "MCQS" })).toBe(false);
    expect(isCbeQuizQuestion(undefined)).toBe(false);
  });
});

describe("recorded CBE rows", () => {
  const row = (extra: Record<string, unknown>) =>
    JSON.stringify({ type: "CBE_RESPONSE", answer: written, marks: 0, maxMarks: 10, ...extra });

  it("reads the server's row and ignores other question types", () => {
    const parsed = parseCbeRow(row({ cbeState: "EVALUATED", marks: 7.5, isPartial: true, evaluation: { feedback: "ok" } }));
    expect(parsed?.cbeState).toBe("EVALUATED");
    expect(parsed?.marks).toBe(7.5);
    expect(parsed?.evaluation?.feedback).toBe("ok");
    expect(parsed?.answer).toEqual(written);
    expect(parseCbeRow(JSON.stringify({ selectedOptions: [{ id: "o1" }] }))).toBeNull();
    expect(parseCbeRow("not json")).toBeNull();
    expect(parseCbeRow(null)).toBeNull();
  });

  it("counts a row by its marks, and waits while it is being checked", () => {
    expect(cbeReviewStatus(parseCbeRow(row({ cbeState: "EVALUATED", marks: 10, isCorrect: true })), true)).toBe("correct");
    expect(cbeReviewStatus(parseCbeRow(row({ cbeState: "EVALUATED", marks: 4, isPartial: true })), true)).toBe("partial");
    expect(cbeReviewStatus(parseCbeRow(row({ cbeState: "EVALUATED", marks: 0 })), true)).toBe("wrong");
    expect(cbeReviewStatus(parseCbeRow(row({ cbeState: "PENDING" })), true)).toBe("pending");
    expect(cbeReviewStatus(parseCbeRow(row({ cbeState: "FAILED", error: "NO_CREDITS" })), true)).toBe("pending");
    expect(cbeReviewStatus(parseCbeRow(row({ cbeState: "SKIPPED", answer: null })), false)).toBe("skipped");
    expect(cbeReviewStatus(null, true)).toBe("pending");
    expect(cbeReviewStatus(null, false)).toBe("skipped");
  });

  it("asks for grading only where a check never ran or failed", () => {
    expect(cbeStateWantsGrading("PENDING")).toBe(true);
    expect(cbeStateWantsGrading("FAILED")).toBe(true);
    expect(cbeStateWantsGrading("EVALUATED")).toBe(false);
    expect(cbeStateWantsGrading("EVALUATING")).toBe(false);
    expect(cbeStateWantsGrading("NO_CHECKS_LEFT")).toBe(false);
  });
});
