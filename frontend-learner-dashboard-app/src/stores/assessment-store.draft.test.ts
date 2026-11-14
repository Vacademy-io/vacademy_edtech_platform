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
const { useAssessmentStore, answerCommitModeOf, displayedAnswerFor } = await import(
  "./assessment-store"
);
const { buildAttemptPayload } = await import(
  "@/components/common/questionLiveTest/engine/attempt-payload"
);

const question = (id: string, type = "MCQS") => ({
  question_id: id,
  question_type: type,
  question_duration: 0,
});

const paper = (examInterface: unknown, distribution = "ASSESSMENT") =>
  ({
    attempt_id: "att-1",
    duration: 60,
    can_switch_section: true,
    distribution_duration: distribution,
    preview_total_time: 0,
    assessment_user_registration_id: "reg-1",
    exam_interface: examInterface,
    section_dtos: [
      {
        id: "s1",
        duration: 30,
        question_preview_dto_list: [question("q1"), question("q2"), question("q3", "NUMERIC")],
      },
      {
        id: "s2",
        duration: 30,
        question_preview_dto_list: [question("q4")],
      },
    ],
  }) as never;

const STRICT = { v: 1, preset: "jee-main", strict: true };
const PRACTICE = { v: 1, preset: "jee-main", strict: false };

const store = () => useAssessmentStore.getState();
const q = (id: string) =>
  store().assessment!.section_dtos.flatMap((s) => s.question_preview_dto_list).find(
    (item) => item.question_id === id,
  )!;
const load = (examInterface: unknown, distribution?: string) => {
  store().resetAssessment();
  store().setAssessment(paper(examInterface, distribution));
  store().setCurrentQuestion(q("q1"));
};
const payloadAnswers = () =>
  buildAttemptPayload(store() as never, {
    assessmentId: "a-1",
    status: "LIVE",
    startTimeMs: 0,
    nowMs: 0,
  });

beforeEach(() => store().resetAssessment());

describe("auto mode (default screen and practice-friendly themes)", () => {
  it.each([
    ["no exam_interface", null],
    ["practice-friendly jee-main", PRACTICE],
  ])("%s: a pick is saved at once, exactly as before", (_label, value) => {
    load(value);
    expect(answerCommitModeOf(store())).toBe("auto");
    const draftsBefore = store().draftAnswers;

    store().setAnswer("q1", ["o2"]);

    expect(store().answers.q1).toEqual(["o2"]);
    expect(store().questionStates.q1.isAnswered).toBe(true);
    expect(store().draftAnswers).toBe(draftsBefore);
    expect(store().draftAnswers).toEqual({});

    store().setCurrentQuestion(q("q2"));
    expect(store().answers.q1).toEqual(["o2"]);
    expect(store().draftAnswers).toBe(draftsBefore);
  });

  it("commitDraft and discardDraft do nothing without drafts", () => {
    load(null);
    store().setAnswer("q1", ["o1"]);
    const before = store();
    store().commitDraft("q1");
    store().discardDraft("q1");
    expect(store().answers).toBe(before.answers);
    expect(store().questionStates).toBe(before.questionStates);
  });
});

describe("explicit mode (strict TCS themes)", () => {
  beforeEach(() => load(STRICT));

  it("resolves from the paper's exam_interface", () => {
    expect(answerCommitModeOf(store())).toBe("explicit");
  });

  it("a pick is a draft: shown, but not saved, answered or sent", () => {
    store().setAnswer("q1", ["o3"]);

    expect(store().draftAnswers.q1).toEqual(["o3"]);
    expect(store().answers.q1).toBeUndefined();
    expect(store().questionStates.q1.isAnswered).toBe(false);
    expect(displayedAnswerFor(store(), "q1")).toEqual(["o3"]);
    expect(JSON.stringify(payloadAnswers())).not.toContain("o3");
  });

  it("commitDraft saves the draft and marks the question answered", () => {
    store().setAnswer("q1", ["o3"]);
    store().commitDraft("q1");

    expect(store().answers.q1).toEqual(["o3"]);
    expect(store().draftAnswers).toEqual({});
    expect(store().questionStates.q1.isAnswered).toBe(true);
    expect(JSON.stringify(payloadAnswers())).toContain("o3");
  });

  it("committing an emptied draft leaves the question unanswered", () => {
    store().setAnswer("q3", ["4"]);
    store().commitDraft("q3");
    store().setAnswer("q3", [""]);
    store().commitDraft("q3");
    expect(store().answers.q3).toEqual([""]);
    expect(store().questionStates.q3.isAnswered).toBe(false);
  });

  it("a lone minus or point saves no answer", () => {
    for (const partial of ["-", ".", "-."]) {
      store().setAnswer("q3", ["4"]);
      store().commitDraft("q3");
      store().setAnswer("q3", [partial]);
      store().commitDraft("q3");
      expect(store().answers.q3).toEqual([]);
      expect(store().questionStates.q3.isAnswered).toBe(false);
    }
    store().setAnswer("q3", ["-0.5"]);
    store().commitDraft("q3");
    expect(store().answers.q3).toEqual(["-0.5"]);
  });

  it("leaving a question discards its draft and keeps the saved answer", () => {
    store().setAnswer("q1", ["o1"]);
    store().commitDraft("q1");
    store().setAnswer("q1", ["o4"]);

    store().setCurrentQuestion(q("q2"));

    expect(store().draftAnswers.q1).toBeUndefined();
    expect(store().answers.q1).toEqual(["o1"]);
    expect(displayedAnswerFor(store(), "q1")).toEqual(["o1"]);
    expect(store().questionStates.q1.isAnswered).toBe(true);
  });

  it("re-opening the same question keeps its draft", () => {
    store().setAnswer("q1", ["o2"]);
    store().setCurrentQuestion(q("q1"));
    expect(store().draftAnswers.q1).toEqual(["o2"]);
  });

  it("only the outgoing question's draft is discarded", () => {
    store().setAnswer("q2", ["x"]); // e.g. written while q2 was open earlier
    store().setAnswer("q1", ["o2"]);
    store().setCurrentQuestion(q("q3"));
    expect(store().draftAnswers).toEqual({ q2: ["x"] });
  });

  it("discardDraft drops only the draft", () => {
    store().setAnswer("q1", ["o1"]);
    store().commitDraft("q1");
    store().setAnswer("q1", ["o2"]);
    store().discardDraft("q1");
    expect(store().draftAnswers).toEqual({});
    expect(store().answers.q1).toEqual(["o1"]);
  });

  it("clearResponse removes the draft and the saved answer", () => {
    store().setAnswer("q1", ["o1"]);
    store().commitDraft("q1");
    store().setAnswer("q1", ["o2"]);
    store().clearResponse("q1");
    expect(store().draftAnswers).toEqual({});
    expect(store().answers.q1).toEqual([]);
    expect(store().questionStates.q1.isAnswered).toBe(false);
  });

  it("a section time-up switch discards the open question's draft", () => {
    load(STRICT, "SECTION");
    store().setAnswer("q1", ["o2"]);
    store().updateSectionTimer(0, 0);
    expect(store().currentSection).toBe(1);
    expect(store().draftAnswers).toEqual({});
    expect(store().answers.q1).toBeUndefined();
  });

  it("reloading the paper drops unsaved drafts", () => {
    store().setAnswer("q1", ["o2"]);
    store().setAssessment(paper(STRICT));
    expect(store().draftAnswers).toEqual({});
  });
});

describe("setMarkedForReview", () => {
  beforeEach(() => load(null));

  it("sets and clears the flag instead of toggling it", () => {
    store().setMarkedForReview("q1", true);
    store().setMarkedForReview("q1", true);
    expect(store().questionStates.q1.isMarkedForReview).toBe(true);
    store().setMarkedForReview("q1", false);
    expect(store().questionStates.q1.isMarkedForReview).toBe(false);
  });

  it("keeps the other flags", () => {
    store().setAnswer("q1", ["o1"]);
    store().setMarkedForReview("q1", true);
    expect(store().questionStates.q1).toMatchObject({
      isAnswered: true,
      isVisited: true,
      isMarkedForReview: true,
    });
  });

  it("does not throw for a question with no state yet", () => {
    store().setMarkedForReview("unknown", true);
    expect(store().questionStates.unknown).toEqual({
      isAnswered: false,
      isVisited: false,
      isDisabled: false,
      isMarkedForReview: true,
    });
  });
});
