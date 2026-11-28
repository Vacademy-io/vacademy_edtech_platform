import { describe, expect, it, vi } from "vitest";
import { cbePartTabLabel, seedPartAnswer } from "../CbeWorkspace";
import { DEFAULT_CBE_STRINGS } from "../cbe-strings";
import { commitCbeEditors, registerCbeCommit } from "../commit-registry";
import type { CbePart } from "../types";

const docPart: CbePart = {
  id: "p_doc",
  label: "(b)",
  kind: "DOCUMENT",
  marks: 4,
  template: { html: "<p>Start here</p>" },
};
const sheetPart: CbePart = {
  id: "p_sheet",
  label: "(a)",
  kind: "SPREADSHEET",
  marks: 1,
  template: { sheet: { sheets: [{ name: "Sheet1", cells: { A1: { v: "Revenue" } } }] } },
};

describe("seedPartAnswer", () => {
  it("starts from the template only when nothing is stored", () => {
    expect(seedPartAnswer(docPart, undefined)).toEqual({ kind: "DOCUMENT", html: "<p>Start here</p>" });
    expect(seedPartAnswer(sheetPart, undefined)).toEqual({ kind: "SPREADSHEET", sheet: sheetPart.template && "sheet" in sheetPart.template ? sheetPart.template.sheet : null });
  });

  it("keeps a part the learner deliberately emptied empty", () => {
    expect(seedPartAnswer(docPart, { kind: "DOCUMENT", html: "" })).toEqual({ kind: "DOCUMENT", html: "" });
    const emptySheet = { kind: "SPREADSHEET" as const, sheet: { sheets: [{ name: "Sheet1", cells: {} }] } };
    expect(seedPartAnswer(sheetPart, emptySheet)).toBe(emptySheet);
  });

  it("ignores a stored answer of the wrong kind", () => {
    expect(seedPartAnswer(docPart, { kind: "SPREADSHEET", sheet: { sheets: [] } }).kind).toBe("DOCUMENT");
  });
});

describe("cbePartTabLabel", () => {
  it("uses English by default and the given strings otherwise", () => {
    expect(cbePartTabLabel(sheetPart)).toBe("(a) Spreadsheet · 1 mark");
    expect(cbePartTabLabel(docPart)).toBe("(b) Document · 4 marks");
    const fr = { ...DEFAULT_CBE_STRINGS, kind: { SPREADSHEET: "Tableur", DOCUMENT: "Document" }, marks: (n: number) => `${n} points` };
    expect(cbePartTabLabel(sheetPart, fr)).toBe("(a) Tableur · 1 points");
  });
});

describe("commit registry", () => {
  it("runs every registered commit, survives a failing one, and stops after unregister", () => {
    const a = vi.fn();
    const b = vi.fn(() => {
      throw new Error("boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const offA = registerCbeCommit(a);
    const offB = registerCbeCommit(b);
    commitCbeEditors();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
    commitCbeEditors();
    expect(a).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
