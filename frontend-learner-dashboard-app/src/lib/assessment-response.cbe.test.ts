import { describe, expect, it } from "vitest";
import {
  decodeAnswer,
  decodeCbeAnswer,
  decodeCbePasteAttempts,
  decodeCodingAnswer,
  encodeQuestionResponse,
  encodeResponseData,
  responseHasAnswer,
  type ResponseData,
} from "./assessment-response";
import type { CbeAnswer, CbeConfig } from "@/components/cbe/types";

const CONFIG: CbeConfig = {
  type: "CBE_RESPONSE",
  data: {
    version: 1,
    parts: [
      {
        id: "p_sheet",
        label: "(a)",
        kind: "SPREADSHEET",
        marks: 16,
        template: { sheet: { sheets: [{ name: "Sheet1", cells: { A1: { v: "Goodwill" } } }] } },
      },
      { id: "p_doc", label: "(b)", kind: "DOCUMENT", marks: 4, template: null },
    ],
  },
};

const ANSWER: CbeAnswer = {
  parts: {
    p_sheet: {
      kind: "SPREADSHEET",
      sheet: {
        sheets: [
          {
            name: "Sheet1",
            cells: {
              A1: { v: "Goodwill" },
              B1: { v: 3200, s: { nf: "#,##0", b: 1 } },
              B2: { v: 6400, f: "=B1*2" },
            },
          },
          { name: "Workings", cells: { A1: { v: "W1", s: { bb: 1 } } } },
        ],
      },
    },
    p_doc: { kind: "DOCUMENT", html: "<p>IAS 38 prohibits capitalising <b>research</b>.</p>" },
  },
};

/** What goes over the wire is JSON: round-trip through it like the server does. */
const wire = (data: ResponseData): ResponseData => JSON.parse(JSON.stringify(data));

describe("CBE_RESPONSE encode / decode", () => {
  it("encodes { type, answer: { parts } } (contract §4) and decodes it back unchanged", () => {
    const encoded = encodeResponseData("CBE_RESPONSE", undefined, undefined, {
      answer: ANSWER,
      pasteAttemptCount: 2,
    });
    expect(encoded.type).toBe("CBE_RESPONSE");
    expect(encoded.answer).toEqual({ parts: ANSWER.parts });
    expect(encoded.optionIds).toBeUndefined();

    const back = wire(encoded);
    expect(decodeCbeAnswer(back)).toEqual(ANSWER);
    expect(decodeCbePasteAttempts(back)).toBe(2);
    // CBE answers never leak into the string-array answers or the coding map.
    expect(decodeAnswer(back)).toEqual([]);
    expect(decodeCodingAnswer(back)).toBeNull();
  });

  it("sends an empty parts map (never optionIds) when the learner has not typed anything", () => {
    const encoded = encodeResponseData("CBE_RESPONSE", undefined, undefined, undefined);
    expect(encoded).toEqual({ type: "CBE_RESPONSE", answer: { parts: {} }, pasteAttemptCount: 0 });
    expect(decodeCbeAnswer(wire(encoded))).toEqual({ parts: {} });
  });

  it("keeps an answer over the 300 KB cap rather than dropping it", () => {
    const big = "x".repeat(320_000);
    const answer: CbeAnswer = { parts: { p_doc: { kind: "DOCUMENT", html: `<p>${big}</p>` } } };
    const encoded = encodeResponseData("CBE_RESPONSE", undefined, undefined, { answer });
    expect(decodeCbeAnswer(wire(encoded))).toEqual(answer);
  });

  it("responseHasAnswer ignores content that only repeats the template", () => {
    const templateOnly = encodeResponseData("CBE_RESPONSE", undefined, undefined, {
      answer: {
        parts: {
          p_sheet: { kind: "SPREADSHEET", sheet: { sheets: [{ name: "Sheet1", cells: { A1: { v: "Goodwill" } } }] } },
        },
      },
    });
    expect(responseHasAnswer(wire(templateOnly), CONFIG)).toBe(false);
    expect(responseHasAnswer(wire(encodeResponseData("CBE_RESPONSE", undefined, undefined, { answer: ANSWER })), CONFIG)).toBe(true);
    expect(responseHasAnswer(wire(encodeResponseData("CBE_RESPONSE", undefined)), CONFIG)).toBe(false);
  });

  it("decodes a malformed CBE payload to an empty answer instead of throwing", () => {
    expect(decodeCbeAnswer({ type: "CBE_RESPONSE", answer: "oops" })).toEqual({ parts: {} });
    expect(decodeCbeAnswer({ type: "CBE_RESPONSE" })).toEqual({ parts: {} });
    expect(decodeCbeAnswer({ type: "LONG_ANSWER", answer: "text" })).toBeNull();
  });

  it("ONE_WORD / LONG_ANSWER decode only string answers", () => {
    expect(decodeAnswer({ type: "LONG_ANSWER", answer: "hello" })).toEqual(["hello"]);
    expect(decodeAnswer({ type: "LONG_ANSWER", answer: { parts: {} } })).toEqual([]);
  });
});

describe("encodeQuestionResponse (shared by autosave, submit and restart)", () => {
  const maps = {
    answers: { mcq: ["o1"], num: ["12.5"], lw: ["essay"] },
    codingAnswers: {},
    cbeAnswers: { cbe: ANSWER },
    cbePasteAttempts: { cbe: 1 },
  };

  it("routes every type to its own wire shape", () => {
    expect(encodeQuestionResponse({ question_id: "mcq", question_type: "MCQS" }, maps)).toEqual({
      type: "MCQS",
      optionIds: ["o1"],
    });
    expect(encodeQuestionResponse({ question_id: "num", question_type: "NUMERIC" }, maps)).toEqual({
      type: "NUMERIC",
      validAnswer: 12.5,
    });
    expect(encodeQuestionResponse({ question_id: "lw", question_type: "LONG_ANSWER" }, maps)).toEqual({
      type: "LONG_ANSWER",
      answer: "essay",
    });
    expect(encodeQuestionResponse({ question_id: "cbe", question_type: "CBE_RESPONSE" }, maps)).toEqual({
      type: "CBE_RESPONSE",
      answer: { parts: ANSWER.parts },
      pasteAttemptCount: 1,
    });
  });

  it("an unanswered CBE question still sends type CBE_RESPONSE (the backend picks its strategy by type)", () => {
    expect(encodeQuestionResponse({ question_id: "other", question_type: "CBE_RESPONSE" }, maps).type).toBe(
      "CBE_RESPONSE",
    );
  });
});
