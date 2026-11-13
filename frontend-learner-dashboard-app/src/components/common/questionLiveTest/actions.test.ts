// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/storage", () => ({
  Storage: {
    get: async () => ({ value: null }),
    set: async () => undefined,
    remove: async () => undefined,
    keys: async () => ({ keys: [] }),
  },
}));
vi.mock("@sentry/react", () => ({ addBreadcrumb: () => undefined }));

const { useAssessmentStore } = await import("@/stores/assessment-store");
const { resolveExamTheme } = await import("./themes");
const { buildAttemptPayload } = await import("./engine/attempt-payload");
const { chipStatusOf } = await import("./widgets/palette-logic");
const {
  EXAM_ACTIONS,
  consoleNextTarget,
  consolePrevTarget,
  goToTarget,
  isSubmitLocked,
  jumpToPaletteTarget,
  jumpToQuestion,
  runExamAction,
} = await import("./actions");
const { CONSOLE_BUTTONS, NTA_MOCK_BUTTONS, consoleChromeFor } = await import(
  "./layouts/console-chrome"
);
const { effectiveAnswerCommit, renderedLayoutKind } = await import("./themes/layouts");
type ExamActionContext = import("./actions").ExamActionContext;

const question = (id: string, type = "MCQS") => ({
  question_id: id,
  question_type: type,
  question_duration: 0,
});

// Section 1: q1, q2, q3 (numerical). Section 2: q4, q5.
const paper = (examInterface: unknown, canSwitch = true) =>
  ({
    attempt_id: "att-1",
    duration: 60,
    can_switch_section: canSwitch,
    distribution_duration: "ASSESSMENT",
    preview_total_time: 0,
    assessment_user_registration_id: "reg-1",
    exam_interface: examInterface,
    section_dtos: [
      {
        id: "s1",
        name: "Physics",
        duration: 30,
        question_preview_dto_list: [question("q1"), question("q2"), question("q3", "NUMERIC")],
      },
      {
        id: "s2",
        name: "Chemistry",
        duration: 30,
        question_preview_dto_list: [question("q4"), question("q5")],
      },
    ],
  }) as never;

const STRICT_JEE = { v: 1, preset: "jee-advanced", strict: true };
const PRACTICE_JEE = { v: 1, preset: "jee-advanced", strict: false };
const STRICT_GATE = { v: 1, preset: "gate", strict: true };
const PRACTICE_GATE = { v: 1, preset: "gate", strict: false };

const store = () => useAssessmentStore.getState();
const q = (id: string) =>
  store()
    .assessment!.section_dtos.flatMap((s) => s.question_preview_dto_list)
    .find((item) => item.question_id === id)!;
const status = (id: string) => chipStatusOf(store().questionStates, id);
const currentId = () => store().currentQuestion?.question_id;

let openSubmit = vi.fn();
let examInterface: unknown = STRICT_JEE;

const ctx = (playMode = "EXAM"): ExamActionContext => ({
  getStore: useAssessmentStore.getState,
  theme: resolveExamTheme(store().assessment?.exam_interface),
  playMode,
  openSubmit,
  openQuestionPaper: vi.fn(),
  openInstructions: vi.fn(),
});
const run = (id: Parameters<typeof runExamAction>[0], playMode?: string) =>
  runExamAction(id, ctx(playMode));

/** Loads the paper and opens a question (in its section). */
const load = (value: unknown, opts: { canSwitch?: boolean; at?: string } = {}) => {
  examInterface = value;
  store().resetAssessment();
  store().setAssessment(paper(examInterface, opts.canSwitch ?? true));
  const at = opts.at ?? "q1";
  const section = store().assessment!.section_dtos.findIndex((s) =>
    s.question_preview_dto_list.some((item) => item.question_id === at),
  );
  if (section !== store().currentSection) store().setCurrentSection(section);
  store().setCurrentQuestion(q(at));
};

const submittedAnswers = () =>
  JSON.stringify(
    buildAttemptPayload(store() as never, {
      assessmentId: "a-1",
      status: "LIVE",
      startTimeMs: 0,
      nowMs: 0,
    }),
  );

beforeEach(() => {
  openSubmit = vi.fn();
  load(STRICT_JEE);
});

describe("strict console (explicit saving)", () => {
  it("opening a question marks it visited: Not Answered; others Not Visited", () => {
    expect(status("q1")).toBe("not-answered");
    expect(status("q2")).toBe("not-visited");
  });

  it("picking an option changes only the draft, not the chip", () => {
    store().setAnswer("q1", ["o1"]);
    expect(store().draftAnswers.q1).toEqual(["o1"]);
    expect(store().answers.q1).toBeUndefined();
    expect(status("q1")).toBe("not-answered");
    expect(submittedAnswers()).not.toContain("o1");
  });

  it("Save & Next commits the draft (Answered) and opens the next question", () => {
    store().setAnswer("q1", ["o1"]);
    expect(run("save-next")).toBe(true);
    expect(store().answers.q1).toEqual(["o1"]);
    expect(status("q1")).toBe("answered");
    expect(currentId()).toBe("q2");
    expect(status("q2")).toBe("not-answered");
    expect(submittedAnswers()).toContain("o1");
  });

  it("Save & Next with nothing picked leaves Not Answered and moves on", () => {
    run("save-next");
    expect(status("q1")).toBe("not-answered");
    expect(currentId()).toBe("q2");
  });

  it("Save & Next keeps an earlier saved answer when there is no new pick", () => {
    store().setAnswer("q1", ["o2"]);
    run("save-next");
    jumpToQuestion(store(), q("q1"));
    run("save-next");
    expect(store().answers.q1).toEqual(["o2"]);
    expect(status("q1")).toBe("answered");
  });

  it("Save & Next on a section's last question opens the next section's first", () => {
    load(STRICT_JEE, { at: "q3" });
    run("save-next");
    expect(store().currentSection).toBe(1);
    expect(currentId()).toBe("q4");
  });

  it("Save & Next on the paper's last question wraps to the first question", () => {
    load(STRICT_JEE, { at: "q5" });
    store().setAnswer("q5", ["o1"]);
    run("save-next");
    expect(status("q5")).toBe("answered");
    expect(store().currentSection).toBe(0);
    expect(currentId()).toBe("q1");
  });

  it("stays on the last question when section 1 may not be re-entered", () => {
    // Section-timed paper without free switching: section 1's clock ran out.
    const lastOfPaper = {
      ...store(),
      assessment: { ...store().assessment!, can_switch_section: false },
      currentSection: 1,
      currentQuestion: q("q5"),
      sectionTimers: { 0: { timeLeft: 0 }, 1: { timeLeft: 300 } },
    };
    expect(consoleNextTarget(lastOfPaper)).toBeNull();
    // With free switching it wraps.
    expect(
      consoleNextTarget({
        ...lastOfPaper,
        assessment: { ...store().assessment!, can_switch_section: true },
        sectionTimers: {},
      })?.question.question_id,
    ).toBe("q1");
  });

  it("Save & Next on a marked question saves it and clears the mark", () => {
    store().setAnswer("q1", ["o1"]);
    run("mark-review-next");
    jumpToQuestion(store(), q("q1"));
    run("save-next");
    expect(status("q1")).toBe("answered");
  });

  it("Mark for Review & Next with a pick: Answered & Marked, then next", () => {
    store().setAnswer("q1", ["o4"]);
    run("mark-review-next");
    expect(store().answers.q1).toEqual(["o4"]);
    expect(status("q1")).toBe("answered-marked");
    expect(currentId()).toBe("q2");
    // An answered and marked question is evaluated: it is in the payload.
    expect(submittedAnswers()).toContain("o4");
  });

  it("Mark for Review & Next without a pick: Marked for Review, then next", () => {
    run("mark-review-next");
    expect(status("q1")).toBe("marked");
    expect(currentId()).toBe("q2");
  });

  it("Mark sets the flag; it never toggles it off", () => {
    run("mark-review-next");
    jumpToQuestion(store(), q("q1"));
    run("mark-review-next");
    expect(status("q1")).toBe("marked");
  });

  it("Save & Mark for Review commits and marks, then next", () => {
    store().setAnswer("q1", ["o2"]);
    run("save-mark-review");
    expect(status("q1")).toBe("answered-marked");
    expect(currentId()).toBe("q2");
  });

  it("Clear Response removes the draft and the saved answer and stays", () => {
    store().setAnswer("q1", ["o1"]);
    run("mark-review-next");
    jumpToQuestion(store(), q("q1"));
    store().setAnswer("q1", ["o3"]);
    run("clear");
    expect(store().draftAnswers.q1).toBeUndefined();
    expect(store().answers.q1).toEqual([]);
    expect(status("q1")).toBe("not-answered");
    expect(currentId()).toBe("q1");
    expect(submittedAnswers()).not.toContain("o1");
  });

  it("a palette jump drops the unsaved pick and marks the target visited", () => {
    store().setAnswer("q1", ["o1"]);
    jumpToQuestion(store(), q("q3"));
    expect(store().draftAnswers.q1).toBeUndefined();
    expect(store().answers.q1).toBeUndefined();
    expect(status("q1")).toBe("not-answered");
    expect(status("q3")).toBe("not-answered");
    expect(status("q2")).toBe("not-visited");
  });

  it("a section tab drops the unsaved pick and opens the section's first question", () => {
    store().setAnswer("q1", ["o1"]);
    goToTarget(useAssessmentStore.getState, { section: 1, question: q("q4") });
    expect(store().currentSection).toBe(1);
    expect(currentId()).toBe("q4");
    expect(store().draftAnswers.q1).toBeUndefined();
    expect(status("q1")).toBe("not-answered");
    expect(status("q4")).toBe("not-answered");
  });

  it("Next >> and << Back move without saving (the draft is dropped)", () => {
    store().setAnswer("q1", ["o1"]);
    run("next");
    expect(currentId()).toBe("q2");
    expect(store().answers.q1).toBeUndefined();
    expect(status("q1")).toBe("not-answered");

    store().setAnswer("q2", ["o2"]);
    run("back");
    expect(currentId()).toBe("q1");
    expect(store().answers.q2).toBeUndefined();
  });

  it("<< Back crosses back into the previous section's last question", () => {
    load(STRICT_JEE, { at: "q4" });
    run("back");
    expect(store().currentSection).toBe(0);
    expect(currentId()).toBe("q3");
  });

  it("<< Back is disabled on the very first question", () => {
    expect(EXAM_ACTIONS.back.isEnabled(ctx())).toBe(false);
    expect(run("back")).toBe(false);
  });

  it("numerical answers follow the same draft rule", () => {
    load(STRICT_JEE, { at: "q3" });
    store().setAnswer("q3", ["-2.5"]);
    expect(status("q3")).toBe("not-answered");
    run("save-next");
    expect(store().answers.q3).toEqual(["-2.5"]);
    expect(status("q3")).toBe("answered");
  });

  it("no answer action runs after the paper is submitted", () => {
    useAssessmentStore.setState({ isSubmitted: true });
    store().setAnswer("q1", ["o1"]);
    expect(run("save-next")).toBe(false);
    expect(run("submit")).toBe(false);
    expect(currentId()).toBe("q1");
  });
});

describe("Submit", () => {
  it("opens the confirmation (Exam Summary) when allowed", () => {
    expect(run("submit")).toBe(true);
    expect(openSubmit).toHaveBeenCalledTimes(1);
  });

  it("strict GATE: disabled while time is left, open at 0", () => {
    load(STRICT_GATE);
    useAssessmentStore.setState({ entireTestTimer: 600 });
    expect(isSubmitLocked(ctx())).toBe(true);
    expect(EXAM_ACTIONS.submit.isEnabled(ctx())).toBe(false);
    expect(run("submit")).toBe(false);
    expect(openSubmit).not.toHaveBeenCalled();

    useAssessmentStore.setState({ entireTestTimer: 0 });
    expect(isSubmitLocked(ctx())).toBe(false);
    expect(run("submit")).toBe(true);
  });

  it("strict RRB JE locks Submit too; JEE does not", () => {
    load({ preset: "rrb-je" });
    useAssessmentStore.setState({ entireTestTimer: 600 });
    expect(isSubmitLocked(ctx())).toBe(true);
    load(STRICT_JEE);
    useAssessmentStore.setState({ entireTestTimer: 600 });
    expect(isSubmitLocked(ctx())).toBe(false);
  });

  it("practice-friendly GATE: Submit always allowed", () => {
    load(PRACTICE_GATE);
    useAssessmentStore.setState({ entireTestTimer: 600 });
    expect(isSubmitLocked(ctx())).toBe(false);
    expect(run("submit")).toBe(true);
  });

  it("an untimed play mode never locks Submit", () => {
    load(STRICT_GATE);
    useAssessmentStore.setState({ entireTestTimer: 600 });
    expect(isSubmitLocked(ctx("PRACTICE"))).toBe(false);
  });
});

describe("practice-friendly console (auto saving)", () => {
  beforeEach(() => load(PRACTICE_JEE));

  it("a pick counts at once and the chip changes", () => {
    store().setAnswer("q1", ["o1"]);
    expect(store().answers.q1).toEqual(["o1"]);
    expect(status("q1")).toBe("answered");
  });

  it("the actions behave the same otherwise", () => {
    store().setAnswer("q1", ["o1"]);
    run("mark-review-next");
    expect(status("q1")).toBe("answered-marked");
    expect(currentId()).toBe("q2");
    jumpToQuestion(store(), q("q1"));
    run("clear");
    expect(status("q1")).toBe("not-answered");
  });
});

describe("action registry", () => {
  it("has every console action with a label key and a variant", () => {
    const ids = [
      "save-next",
      "mark-review-next",
      "save-mark-review",
      "clear",
      "back",
      "next",
      "submit",
      "question-paper",
      "view-instructions",
    ] as const;
    for (const id of ids) {
      expect(EXAM_ACTIONS[id].id).toBe(id);
      expect(EXAM_ACTIONS[id].labelKey).toMatch(/^examThemes\.tcs\./);
      expect(EXAM_ACTIONS[id].variant).toBeTruthy();
    }
  });

  it("the header links open their dialogs", () => {
    const context = ctx();
    runExamAction("question-paper", context);
    runExamAction("view-instructions", context);
    expect(context.openQuestionPaper).toHaveBeenCalledTimes(1);
    expect(context.openInstructions).toHaveBeenCalledTimes(1);
  });
});

describe("NTA mock layout (jee-main)", () => {
  const STRICT_NTA = { v: 1, preset: "jee-main", strict: true };
  const PRACTICE_NTA = { v: 1, preset: "jee-main", strict: false };
  beforeEach(() => load(STRICT_NTA));

  it("jee-main with no layout, or nta-mock, draws the NTA mock with strict saving", () => {
    for (const value of [
      { v: 1, preset: "jee-main" },
      { v: 1, preset: "jee-main", layout: "nta-mock" },
    ]) {
      const theme = resolveExamTheme(value);
      expect(theme.layout).toEqual({ kind: "console", variant: "nta-mock" });
      expect(renderedLayoutKind(theme)).toBe("console");
      expect(effectiveAnswerCommit(theme)).toBe("explicit");
    }
    expect(effectiveAnswerCommit(resolveExamTheme(PRACTICE_NTA))).toBe("auto");
  });

  it("arranges the seven buttons: two rows, then Back / Next and Submit", () => {
    expect(NTA_MOCK_BUTTONS.rows).toEqual([
      ["save-next", "save-mark-review", "clear"],
      ["mark-review-next"],
    ]);
    expect(NTA_MOCK_BUTTONS.strip).toEqual({ left: ["back", "next"], right: ["submit"] });
    // Phone: the same actions minus Submit, which is in the palette sheet.
    const phone = [...CONSOLE_BUTTONS["nta-mock"].left, ...CONSOLE_BUTTONS["nta-mock"].right];
    expect(new Set(phone)).toEqual(
      new Set(["save-next", "save-mark-review", "clear", "mark-review-next", "back", "next"]),
    );
  });

  it("chrome: no header links, Remaining Time pill, 'Question N:' and the short name", () => {
    const nta = consoleChromeFor(resolveExamTheme(STRICT_NTA));
    expect(nta).toMatchObject({
      headerLinks: [],
      clockLabel: "pill",
      questionLabel: "question-colon",
      scrollJump: "always",
      examShortName: "JEE Main",
    });
    // jee-main on the TCS console keeps the console's chrome.
    const tcs = consoleChromeFor(
      resolveExamTheme({ ...STRICT_NTA, layout: "tcs-console" }),
    );
    expect(tcs).toMatchObject({
      headerLinks: ["question-paper", "view-instructions"],
      clockLabel: "space-colon",
      questionLabel: "question-no",
      scrollJump: "when-long",
    });
    // Other presets never get the NTA chrome.
    expect(consoleChromeFor(resolveExamTheme(STRICT_GATE)).clockLabel).toBe("space-colon");
  });

  it("a pick is a draft; SAVE & NEXT commits it and opens the next question", () => {
    store().setAnswer("q1", ["o1"]);
    expect(status("q1")).toBe("not-answered");
    expect(run("save-next")).toBe(true);
    expect(status("q1")).toBe("answered");
    expect(currentId()).toBe("q2");
  });

  it("SAVE & MARK FOR REVIEW: Answered & Marked (evaluated), then next", () => {
    store().setAnswer("q1", ["o2"]);
    run("save-mark-review");
    expect(status("q1")).toBe("answered-marked");
    expect(store().answers.q1).toEqual(["o2"]);
    expect(currentId()).toBe("q2");
    expect(submittedAnswers()).toContain("o2");
  });

  it("MARK FOR REVIEW & NEXT without a pick: Marked for Review, then next", () => {
    run("mark-review-next");
    expect(status("q1")).toBe("marked");
    expect(currentId()).toBe("q2");
  });

  it("CLEAR RESPONSE removes the saved answer and stays", () => {
    store().setAnswer("q1", ["o1"]);
    run("save-next");
    jumpToQuestion(store(), q("q1"));
    run("clear");
    expect(status("q1")).toBe("not-answered");
    expect(store().answers.q1 ?? []).toEqual([]);
    expect(currentId()).toBe("q1");
  });

  it("<< BACK and NEXT >> move without saving", () => {
    store().setAnswer("q1", ["o1"]);
    run("next");
    expect(currentId()).toBe("q2");
    expect(status("q1")).toBe("not-answered");
    expect(submittedAnswers()).not.toContain("o1");
    run("back");
    expect(currentId()).toBe("q1");
  });

  it("a palette jump to another subject drops the pick and opens that question", () => {
    store().setAnswer("q1", ["o1"]);
    expect(jumpToPaletteTarget(useAssessmentStore.getState, { section: 1, question: q("q5") })).toBe(
      true,
    );
    expect(store().currentSection).toBe(1);
    expect(currentId()).toBe("q5");
    expect(store().draftAnswers.q1).toBeUndefined();
    expect(status("q1")).toBe("not-answered");
    expect(status("q5")).toBe("not-answered");
    expect(status("q4")).toBe("not-visited");
  });

  it("a palette jump into a section that may not be entered is ignored", () => {
    load(STRICT_NTA, { canSwitch: false });
    store().setAnswer("q1", ["o1"]);
    expect(jumpToPaletteTarget(useAssessmentStore.getState, { section: 1, question: q("q4") })).toBe(
      false,
    );
    expect(store().currentSection).toBe(0);
    expect(currentId()).toBe("q1");
    // The pick is still a draft on the open question.
    expect(store().draftAnswers.q1).toEqual(["o1"]);
  });

  it("a palette jump inside the subject works as on the console", () => {
    expect(jumpToPaletteTarget(useAssessmentStore.getState, { section: 0, question: q("q3") })).toBe(
      true,
    );
    expect(currentId()).toBe("q3");
  });

  it("no palette jump after the paper is submitted", () => {
    useAssessmentStore.setState({ isSubmitted: true });
    expect(jumpToPaletteTarget(useAssessmentStore.getState, { section: 0, question: q("q2") })).toBe(
      false,
    );
    expect(currentId()).toBe("q1");
  });

  it("SUBMIT may be pressed early (opens the Exam Summary)", () => {
    useAssessmentStore.setState({ entireTestTimer: 600 });
    expect(isSubmitLocked(ctx())).toBe(false);
    expect(run("submit")).toBe(true);
    expect(openSubmit).toHaveBeenCalledTimes(1);
  });

  it("practice-friendly: a pick counts at once; the buttons behave the same", () => {
    load(PRACTICE_NTA);
    store().setAnswer("q1", ["o1"]);
    expect(status("q1")).toBe("answered");
    run("save-mark-review");
    expect(status("q1")).toBe("answered-marked");
    expect(currentId()).toBe("q2");
  });
});

describe("no free switching, no section clocks (sections open one after another)", () => {
  const STRICT_NTA_SEQ = { v: 1, preset: "jee-main", strict: true };

  for (const value of [STRICT_JEE, STRICT_NTA_SEQ]) {
    it(`Save & Next from the last question of section 1 opens section 2 (${value.preset})`, () => {
      load(value, { canSwitch: false, at: "q3" });
      store().setAnswer("q3", ["12"]);
      expect(run("save-next")).toBe(true);
      expect(store().currentSection).toBe(1);
      expect(currentId()).toBe("q4");
      expect(store().answers.q3).toEqual(["12"]);
    });
  }

  it("Mark for Review & Next and Next >> cross too", () => {
    load(STRICT_NTA_SEQ, { canSwitch: false, at: "q3" });
    expect(run("mark-review-next")).toBe(true);
    expect(currentId()).toBe("q4");
    expect(status("q3")).toBe("marked");

    load(STRICT_NTA_SEQ, { canSwitch: false, at: "q3" });
    store().setAnswer("q3", ["7"]);
    expect(run("next")).toBe(true);
    expect(store().currentSection).toBe(1);
    expect(currentId()).toBe("q4");
    // Next does not save.
    expect(store().answers.q3).toBeUndefined();
  });

  it("an earlier section does not open again, and the paper does not wrap", () => {
    load(STRICT_JEE, { canSwitch: false, at: "q3" });
    run("save-next");
    expect(store().currentSection).toBe(1);
    // Palette jump back into section 1: ignored.
    expect(jumpToPaletteTarget(useAssessmentStore.getState, { section: 0, question: q("q1") })).toBe(
      false,
    );
    // Back on the first question of section 2 stays.
    expect(consolePrevTarget(store())).toBeNull();
    // Last question of the paper: no wrap to section 1.
    jumpToQuestion(store(), q("q5"));
    expect(consoleNextTarget(store())).toBeNull();
    expect(run("next")).toBe(false);
    expect(currentId()).toBe("q5");
  });

  it("a palette jump ahead into the next section is ignored", () => {
    load(STRICT_NTA_SEQ, { canSwitch: false, at: "q1" });
    expect(jumpToPaletteTarget(useAssessmentStore.getState, { section: 1, question: q("q4") })).toBe(
      false,
    );
    expect(currentId()).toBe("q1");
  });
});
