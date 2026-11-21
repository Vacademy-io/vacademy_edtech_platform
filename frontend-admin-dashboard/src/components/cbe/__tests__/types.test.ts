import { describe, expect, it } from "vitest";
import {
  CBE_MAX_ANSWER_BYTES,
  CBE_SECRET_KEYS,
  cbeAnswerSize,
  cbeTotalMarks,
  htmlToPlainText,
  isCbeAnswerEmpty,
  isCbeAnswerTooLarge,
  mergeCbeSecret,
  newPartId,
  parseCbeConfig,
  redactCbeConfig,
  splitCbeSecret,
  type CbeAnswer,
  type CbeConfig,
} from "../types";

const FULL: CbeConfig = {
  type: "CBE_RESPONSE",
  data: {
    version: 1,
    parts: [
      {
        id: "p_8f3k2a",
        label: "(a)",
        promptHtml: "<p>Prepare the consolidated SFP</p>",
        kind: "SPREADSHEET",
        marks: 16,
        template: { sheet: { sheets: [{ name: "Sheet1", cells: { A1: { v: "Goodwill" }, B2: { f: "=1+1", v: 2 } } }] } },
        solution: { sheet: { sheets: [{ name: "Sheet1", cells: { B1: { v: 3200 } } }] } },
        markingScheme: [{ id: "m1", label: "Goodwill", marks: 2, expected: "3,200", cellRef: "Sheet1!B1" }],
        solutionFileId: "media-1",
      },
      {
        id: "p_q91xz0",
        label: "(b)",
        kind: "DOCUMENT",
        marks: 4,
        template: { html: "<p>Answer:</p>" },
        solution: { html: "<p>IAS 38 prohibits…</p>" },
        markingScheme: [],
        solutionFileId: null,
      },
    ],
    gradingNotes: "Apply the own-figure rule.",
  },
};

describe("redact / split / merge", () => {
  it("redacts exactly the secret keys and nothing else", () => {
    const red = redactCbeConfig(FULL);
    const json = JSON.stringify(red);
    expect(json).not.toContain("solution");
    expect(json).not.toContain("markingScheme");
    expect(json).not.toContain("gradingNotes");
    expect(json).not.toContain("IAS 38");
    expect(red.data.parts[0]).toEqual({
      id: "p_8f3k2a",
      label: "(a)",
      promptHtml: "<p>Prepare the consolidated SFP</p>",
      kind: "SPREADSHEET",
      marks: 16,
      template: FULL.data.parts[0]!.template,
    });
    expect(red.data.version).toBe(1);
    expect(red.type).toBe("CBE_RESPONSE");
    // input untouched
    expect(FULL.data.parts[0]!.solutionFileId).toBe("media-1");
    expect(CBE_SECRET_KEYS.part).toEqual(["solution", "markingScheme", "solutionFileId"]);
  });

  it("keeps unknown keys (forward compatible)", () => {
    const withExtra = { ...FULL, data: { ...FULL.data, extra: 1 } } as unknown as CbeConfig;
    expect((redactCbeConfig(withExtra).data as unknown as Record<string, unknown>).extra).toBe(1);
  });

  it("splits into learner-safe config + secret and merges back losslessly", () => {
    const { config, secret } = splitCbeSecret(FULL);
    expect(config).toEqual(redactCbeConfig(FULL));
    expect(secret).toEqual({
      parts: [
        {
          id: "p_8f3k2a",
          solution: FULL.data.parts[0]!.solution,
          markingScheme: FULL.data.parts[0]!.markingScheme,
          solutionFileId: "media-1",
        },
        { id: "p_q91xz0", solution: { html: "<p>IAS 38 prohibits…</p>" }, markingScheme: [], solutionFileId: null },
      ],
      gradingNotes: "Apply the own-figure rule.",
    });
    expect(mergeCbeSecret(config, secret)).toEqual(FULL);
  });

  it("merge ignores secrets for unknown parts and tolerates a missing secret", () => {
    const { config, secret } = splitCbeSecret(FULL);
    const merged = mergeCbeSecret(
      { ...config, data: { ...config.data, parts: [config.data.parts[1]!] } },
      { ...secret, parts: [...secret.parts, { id: "p_gone", solutionFileId: "x" }] },
    );
    expect(merged.data.parts).toHaveLength(1);
    expect(merged.data.parts[0]!.id).toBe("p_q91xz0");
    expect(mergeCbeSecret(config, null)).toBe(config);
  });

  it("parses config JSON strings and rejects other types", () => {
    expect(parseCbeConfig(JSON.stringify(FULL))).toEqual(FULL);
    expect(parseCbeConfig(FULL)).toBe(FULL);
    expect(parseCbeConfig('{"type":"MCQS","data":{}}')).toBeNull();
    expect(parseCbeConfig("not json")).toBeNull();
    expect(parseCbeConfig("")).toBeNull();
    expect(cbeTotalMarks(FULL)).toBe(20);
  });
});

describe("isCbeAnswerEmpty", () => {
  it("treats missing / blank answers as empty", () => {
    expect(isCbeAnswerEmpty(null)).toBe(true);
    expect(isCbeAnswerEmpty({ parts: {} })).toBe(true);
    expect(
      isCbeAnswerEmpty({
        parts: {
          a: { kind: "SPREADSHEET", sheet: { sheets: [{ name: "S", cells: { A1: { v: "  " }, B1: { s: { b: 1 } } } }] } },
          b: { kind: "DOCUMENT", html: "<p>&nbsp;</p><table><tr><td></td></tr></table>" },
        },
      }),
    ).toBe(true);
  });

  it("does not count template content as an answer", () => {
    const sameAsTemplate: CbeAnswer = {
      parts: {
        p_8f3k2a: { kind: "SPREADSHEET", sheet: FULL.data.parts[0]!.template && "sheet" in FULL.data.parts[0]!.template ? FULL.data.parts[0]!.template.sheet : { sheets: [] } },
        p_q91xz0: { kind: "DOCUMENT", html: "<p>Answer:</p>" },
      },
    };
    expect(isCbeAnswerEmpty(sameAsTemplate, FULL)).toBe(true);
    // Without the config the template text does count.
    expect(isCbeAnswerEmpty(sameAsTemplate)).toBe(false);
  });

  it("detects a typed cell, a formula or written text", () => {
    expect(isCbeAnswerEmpty({ parts: { p_8f3k2a: { kind: "SPREADSHEET", sheet: { sheets: [{ name: "Sheet1", cells: { A1: { v: "Goodwill" }, C3: { v: 0 } } }] } } } }, FULL)).toBe(false);
    expect(isCbeAnswerEmpty({ parts: { x: { kind: "SPREADSHEET", sheet: { sheets: [{ name: "S", cells: { A1: { f: "=1+1" } } }] } } } })).toBe(false);
    expect(isCbeAnswerEmpty({ parts: { p_q91xz0: { kind: "DOCUMENT", html: "<p>Answer: IAS 38</p>" } } }, FULL)).toBe(false);
  });

  // Shared fixture with assessment_service CbeAnswersTest.aRecomputedTemplateFormulaIsNotAnAnswer:
  // both sides must agree on "answered" (navigator / submit dialog vs teacher hold + AI billing).
  it("ignores a template formula the grid recomputed on load (same rule as CbeAnswers)", () => {
    const cfg: CbeConfig = {
      type: "CBE_RESPONSE",
      data: {
        version: 1,
        parts: [
          {
            id: "p1",
            label: "",
            kind: "SPREADSHEET",
            marks: 4,
            template: { sheet: { sheets: [{ name: "Sheet1", cells: { A1: { v: "Total" }, B5: { f: "=SUM(B2:B4)" } } }] } },
          },
        ],
      },
    };
    const sheet = (name: string, cells: Record<string, { v?: number | string; f?: string }>): CbeAnswer => ({
      parts: { p1: { kind: "SPREADSHEET", sheet: { sheets: [{ name, cells }] } } },
    });
    expect(isCbeAnswerEmpty(sheet("Sheet1", { A1: { v: "Total" }, B5: { f: "=sum(B2:B4) ", v: 0 } }), cfg)).toBe(true);
    expect(isCbeAnswerEmpty(sheet("Sheet1", { A1: { v: "Total" }, B2: { v: 7 }, B5: { f: "=SUM(B2:B4)", v: 7 } }), cfg)).toBe(false);
    expect(isCbeAnswerEmpty(sheet("Answer", { A1: { v: "Total" } }), cfg)).toBe(false);
  });

  it("strips html to text", () => {
    expect(htmlToPlainText("<p>a<b>b</b></p><script>x()</script><p>&nbsp;c</p>")).toBe("a b c");
  });
});

describe("answer size", () => {
  it("measures UTF-8 bytes of the JSON and flags answers over 300 KB", () => {
    const answer: CbeAnswer = { parts: { a: { kind: "DOCUMENT", html: "€" } } };
    expect(cbeAnswerSize(answer)).toBe(JSON.stringify(answer).length + 2);
    expect(cbeAnswerSize(null)).toBe(0);
    expect(CBE_MAX_ANSWER_BYTES).toBe(300_000);
    const big: CbeAnswer = { parts: { a: { kind: "DOCUMENT", html: "x".repeat(CBE_MAX_ANSWER_BYTES) } } };
    expect(isCbeAnswerTooLarge(big)).toBe(true);
    expect(isCbeAnswerTooLarge(answer)).toBe(false);
  });
});

describe("newPartId", () => {
  it("generates p_ + 6 chars, unique against existing ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = newPartId(seen);
      expect(id).toMatch(/^p_[a-z0-9]{6}$/);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
