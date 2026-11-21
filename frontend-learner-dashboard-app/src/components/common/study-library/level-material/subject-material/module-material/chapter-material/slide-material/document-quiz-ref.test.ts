import { describe, expect, it } from "vitest";
import {
  DOCUMENT_QUIZ_DEFAULT_SPLIT,
  DOCUMENT_QUIZ_MAX_SPLIT,
  DOCUMENT_QUIZ_MIN_SPLIT,
  documentQuizSplitPercent,
  nudgeDocumentQuizSplit,
  parseDocumentQuizRef,
} from "./document-quiz-ref";

// Exactly what the admin app writes (serializeDocumentQuizRef).
const MARKER =
  '{"kind":"DOCUMENT_QUIZ","v":1,"file_id":"3f1c2b9a-6d4e-4f7a-9b1c-2d3e4f5a6b7c","file_name":"Balance sheet.pdf","source":"PDF"}';

describe("parseDocumentQuizRef", () => {
  it("reads the admin marker", () => {
    expect(parseDocumentQuizRef(MARKER)).toEqual({
      fileId: "3f1c2b9a-6d4e-4f7a-9b1c-2d3e4f5a6b7c",
      fileName: "Balance sheet.pdf",
      source: "PDF",
    });
    expect(parseDocumentQuizRef(`  ${MARKER}\n`)?.fileId).toBe(
      "3f1c2b9a-6d4e-4f7a-9b1c-2d3e4f5a6b7c"
    );
    expect(
      parseDocumentQuizRef('{"kind":"DOCUMENT_QUIZ","file_id":"f1","source":"PPT"}')?.source
    ).toBe("PPT");
  });

  it("leaves every ordinary quiz a plain quiz", () => {
    for (const title of [
      undefined,
      null,
      "",
      "Quiz",
      "Untitled Quiz",
      "Chapter 1 quiz {revision}",
      "{not json",
      "[]",
      '{"kind":"OTHER","file_id":"x"}',
      '{"kind":"DOCUMENT_QUIZ"}',
      '{"kind":"DOCUMENT_QUIZ","file_id":"  "}',
      '{"kind":"DOCUMENT_QUIZ","file_id":42}',
      `{"kind":"DOCUMENT_QUIZ","file_id":"f","file_name":"${"x".repeat(300)}"}`,
      42,
    ]) {
      expect(parseDocumentQuizRef(title)).toBeNull();
    }
  });
});

describe("documentQuizSplitPercent", () => {
  it("follows the pointer within the bounds", () => {
    expect(documentQuizSplitPercent(500, 100, 800)).toBe(50);
    expect(documentQuizSplitPercent(380, 100, 800)).toBe(35);
    expect(documentQuizSplitPercent(110, 100, 800)).toBe(DOCUMENT_QUIZ_MIN_SPLIT);
    expect(documentQuizSplitPercent(890, 100, 800)).toBe(DOCUMENT_QUIZ_MAX_SPLIT);
  });

  it("measures from the right edge in right-to-left layouts", () => {
    expect(documentQuizSplitPercent(620, 100, 800, true)).toBe(35);
    expect(documentQuizSplitPercent(880, 100, 800, true)).toBe(DOCUMENT_QUIZ_MIN_SPLIT);
  });

  it("falls back to 50/50 when the container has no size", () => {
    expect(documentQuizSplitPercent(10, 0, 0)).toBe(DOCUMENT_QUIZ_DEFAULT_SPLIT);
    expect(documentQuizSplitPercent(Number.NaN, 0, 100)).toBe(DOCUMENT_QUIZ_DEFAULT_SPLIT);
  });
});

describe("nudgeDocumentQuizSplit", () => {
  it("moves 5% per arrow key and stays in bounds", () => {
    expect(nudgeDocumentQuizSplit(50, "ArrowRight")).toBe(55);
    expect(nudgeDocumentQuizSplit(50, "ArrowLeft")).toBe(45);
    expect(nudgeDocumentQuizSplit(DOCUMENT_QUIZ_MAX_SPLIT, "ArrowRight")).toBe(DOCUMENT_QUIZ_MAX_SPLIT);
    expect(nudgeDocumentQuizSplit(DOCUMENT_QUIZ_MIN_SPLIT, "ArrowLeft")).toBe(DOCUMENT_QUIZ_MIN_SPLIT);
    expect(nudgeDocumentQuizSplit(50, "Enter")).toBeNull();
  });

  it("mirrors the arrows in right-to-left layouts", () => {
    expect(nudgeDocumentQuizSplit(50, "ArrowLeft", true)).toBe(55);
    expect(nudgeDocumentQuizSplit(50, "ArrowRight", true)).toBe(45);
  });
});
