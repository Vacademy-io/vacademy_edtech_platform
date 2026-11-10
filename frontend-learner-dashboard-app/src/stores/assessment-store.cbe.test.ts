// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CbeAnswer, CbeConfig } from "@/components/cbe/types";

const kv = new Map<string, string>();
let quota = Infinity;
const usedChars = () => [...kv.entries()].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
vi.mock("@capacitor/storage", () => ({
  Storage: {
    get: async ({ key }: { key: string }) => ({ value: kv.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      const existing = kv.get(key);
      const next = usedChars() - (existing ? key.length + existing.length : 0) + key.length + value.length;
      if (next > quota) throw new DOMException("quota", "QuotaExceededError");
      kv.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      kv.delete(key);
    },
    keys: async () => ({ keys: [...kv.keys()] }),
  },
}));

const { useAssessmentStore, hasAnswerFor } = await import("./assessment-store");

const CONFIG: CbeConfig = {
  type: "CBE_RESPONSE",
  data: {
    version: 1,
    parts: [
      {
        id: "p1",
        label: "(a)",
        kind: "SPREADSHEET",
        marks: 10,
        template: { sheet: { sheets: [{ name: "Sheet1", cells: { A1: { v: "Revenue" } } }] } },
      },
    ],
  },
};

const sheetAnswer = (cells: Record<string, { v?: number | string; f?: string }>): CbeAnswer => ({
  parts: { p1: { kind: "SPREADSHEET", sheet: { sheets: [{ name: "Sheet1", cells }] } } },
});

const ASSESSMENT = {
  attempt_id: "att-1",
  section_dtos: [
    {
      id: "s1",
      question_preview_dto_list: [
        {
          question_id: "q-cbe",
          question_type: "CBE_RESPONSE",
          evaluation_json: JSON.stringify(CONFIG),
          parent_rich_text: { id: "", type: "HTML", content: "" },
          question: { id: "", type: "HTML", content: "" },
          options: [],
        },
      ],
    },
  ],
};

beforeEach(() => {
  kv.clear();
  quota = Infinity;
  kv.set("InstructionID_and_AboutID", JSON.stringify({ assessment_id: "a-1" }));
  useAssessmentStore.getState().resetAssessment();
  useAssessmentStore.setState({ assessment: ASSESSMENT as never });
});

describe("hasAnswerFor with CBE answers", () => {
  it("counts a cell beyond the template, not the template itself", () => {
    const answered = { "q-cbe": sheetAnswer({ A1: { v: "Revenue" }, B1: { v: 100 } }) };
    const templateOnly = { "q-cbe": sheetAnswer({ A1: { v: "Revenue" } }) };
    expect(hasAnswerFor("q-cbe", {}, {}, answered, CONFIG)).toBe(true);
    expect(hasAnswerFor("q-cbe", {}, {}, templateOnly, CONFIG)).toBe(false);
    expect(hasAnswerFor("q-cbe", {}, {}, {}, CONFIG)).toBe(false);
  });
  it("still works for the old call shape (no CBE map)", () => {
    expect(hasAnswerFor("q1", { q1: ["o1"] }, {})).toBe(true);
    expect(hasAnswerFor("q1", { q1: [" "] }, {})).toBe(false);
  });
});

describe("setCbeAnswer / clearResponse", () => {
  it("marks the question answered (and visited) only when it holds more than the template", () => {
    const { setCbeAnswer } = useAssessmentStore.getState();
    setCbeAnswer("q-cbe", sheetAnswer({ A1: { v: "Revenue" } }));
    expect(useAssessmentStore.getState().questionStates["q-cbe"]).toMatchObject({ isAnswered: false, isVisited: true });

    setCbeAnswer("q-cbe", sheetAnswer({ A1: { v: "Revenue" }, B1: { v: 5, f: "=2+3" } }));
    expect(useAssessmentStore.getState().questionStates["q-cbe"].isAnswered).toBe(true);
    expect(useAssessmentStore.getState().cbeAnswers["q-cbe"]).toBeDefined();
  });

  it("clearResponse drops the CBE answer so the workspace returns to the template", () => {
    const store = useAssessmentStore.getState();
    store.setCbeAnswer("q-cbe", sheetAnswer({ B1: { v: 5 } }));
    store.clearResponse("q-cbe");
    const state = useAssessmentStore.getState();
    expect(state.cbeAnswers["q-cbe"]).toBeUndefined();
    expect(state.questionStates["q-cbe"].isAnswered).toBe(false);
  });

  it("counts blocked pastes per question", () => {
    const store = useAssessmentStore.getState();
    store.incrementCbePasteAttempt("q-cbe");
    store.incrementCbePasteAttempt("q-cbe");
    expect(useAssessmentStore.getState().cbePasteAttempts["q-cbe"]).toBe(2);
  });

  it("setAssessment re-derives isAnswered from a restored CBE answer", () => {
    useAssessmentStore.setState({ cbeAnswers: { "q-cbe": sheetAnswer({ C3: { v: 1 } }) } });
    useAssessmentStore.getState().setAssessment(ASSESSMENT as never);
    expect(useAssessmentStore.getState().questionStates["q-cbe"].isAnswered).toBe(true);
  });
});

describe("saveState / loadState persist CBE answers", () => {
  it("round-trips cbeAnswers and the paste counter through local storage", async () => {
    const answer = sheetAnswer({ B1: { v: 7 } });
    useAssessmentStore.setState({ cbeAnswers: { "q-cbe": answer }, cbePasteAttempts: { "q-cbe": 3 } });
    await useAssessmentStore.getState().saveState();

    kv.set("Assessment_questions", JSON.stringify({ attempt_id: "att-1" }));
    useAssessmentStore.setState({ cbeAnswers: {}, cbePasteAttempts: {} });
    await useAssessmentStore.getState().loadState();

    expect(useAssessmentStore.getState().cbeAnswers["q-cbe"]).toEqual(answer);
    expect(useAssessmentStore.getState().cbePasteAttempts["q-cbe"]).toBe(3);
  });

  it("a large CBE answer that overflows storage still purges old snapshots and retries", async () => {
    kv.set("ASSESSMENT_STATE_old_old", "x".repeat(250_000));
    const answer: CbeAnswer = { parts: { p1: { kind: "DOCUMENT", html: "y".repeat(200_000) } } };
    useAssessmentStore.setState({ cbeAnswers: { "q-cbe": answer } });
    quota = 300_000;

    await expect(useAssessmentStore.getState().saveState()).resolves.toBeUndefined();
    expect(kv.has("ASSESSMENT_STATE_old_old")).toBe(false);
    expect(kv.has("ASSESSMENT_STATE_a-1_att-1")).toBe(true);
  });

  it("skips the local snapshot (no throw) when even the purge cannot make room", async () => {
    const answer: CbeAnswer = { parts: { p1: { kind: "DOCUMENT", html: "y".repeat(400_000) } } };
    useAssessmentStore.setState({ cbeAnswers: { "q-cbe": answer } });
    quota = 300_000;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(useAssessmentStore.getState().saveState()).resolves.toBeUndefined();
    expect(kv.has("ASSESSMENT_STATE_a-1_att-1")).toBe(false);
    warn.mockRestore();
  });

  it("drops the older snapshot when the newer one cannot be stored, so a reload cannot restore stale answers", async () => {
    useAssessmentStore.setState({ cbeAnswers: { "q-cbe": sheetAnswer({ B1: { v: 1 } }) } });
    await useAssessmentStore.getState().saveState();
    expect(kv.has("ASSESSMENT_STATE_a-1_att-1")).toBe(true);

    const big: CbeAnswer = { parts: { p1: { kind: "DOCUMENT", html: "y".repeat(400_000) } } };
    useAssessmentStore.setState({ cbeAnswers: { "q-cbe": big } });
    quota = 300_000;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await useAssessmentStore.getState().saveState();
    warn.mockRestore();
    expect(kv.has("ASSESSMENT_STATE_a-1_att-1")).toBe(false);
  });

  it("falls back to a slim snapshot without the paper; loadState takes the paper from Assessment_questions", async () => {
    const paper = { ...ASSESSMENT, filler: "z".repeat(200_000) };
    kv.set("Assessment_questions", JSON.stringify(paper));
    useAssessmentStore.setState({ assessment: paper as never });
    useAssessmentStore.setState({ cbeAnswers: { "q-cbe": sheetAnswer({ B1: { v: 1 } }) } });
    await useAssessmentStore.getState().saveState(); // full snapshot fits for now

    const newer: CbeAnswer = { parts: { p1: { kind: "DOCUMENT", html: "n".repeat(100_000) } } };
    useAssessmentStore.setState({ cbeAnswers: { "q-cbe": newer } });
    quota = 500_000; // too small for paper + answer twice, fine without the paper
    await useAssessmentStore.getState().saveState();
    const stored = JSON.parse(kv.get("ASSESSMENT_STATE_a-1_att-1") ?? "{}");
    expect(stored.assessment).toBeUndefined();

    useAssessmentStore.setState({ assessment: null as never, cbeAnswers: {} });
    await useAssessmentStore.getState().loadState();
    const state = useAssessmentStore.getState();
    expect(state.cbeAnswers["q-cbe"]).toEqual(newer);
    expect((state.assessment as unknown as { attempt_id: string }).attempt_id).toBe("att-1");
    expect(state).not.toHaveProperty("__slimSnapshot");
  });
});
