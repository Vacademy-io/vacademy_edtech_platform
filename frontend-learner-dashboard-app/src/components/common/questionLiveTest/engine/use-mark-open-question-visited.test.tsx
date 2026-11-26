// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@capacitor/storage", () => ({
  Storage: {
    get: async () => ({ value: null }),
    set: async () => undefined,
    remove: async () => undefined,
    keys: async () => ({ keys: [] }),
  },
}));

const { useAssessmentStore } = await import("@/stores/assessment-store");
const { useMarkOpenQuestionVisited } = await import("./use-mark-open-question-visited");
const { paperSummary } = await import("../widgets/palette-logic");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const questions = ["q1", "q2", "q3", "q4", "q5"].map((id) => ({
  question_id: id,
  question_type: "MCQS",
  question_duration: 0,
}));

// Default screen: no exam theme, so a pick is saved at once.
const paper = () =>
  ({
    attempt_id: "att-1",
    duration: 60,
    can_switch_section: true,
    distribution_duration: "ASSESSMENT",
    preview_total_time: 0,
    assessment_user_registration_id: "reg-1",
    exam_interface: null,
    section_dtos: [{ id: "s1", name: "Section 1", duration: 30, question_preview_dto_list: questions }],
  }) as never;

function Probe() {
  useMarkOpenQuestionVisited();
  return null;
}

const mount = () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  return () => act(() => root.unmount());
};

const store = () => useAssessmentStore.getState();
const summary = () => paperSummary(store().assessment?.section_dtos ?? [], store().questionStates);

describe("useMarkOpenQuestionVisited", () => {
  it("marks the opening question of a fresh paper visited", () => {
    store().resetAssessment();
    store().setAssessment(paper());
    expect(store().questionStates.q1.isVisited).toBe(false);
    const unmount = mount();
    expect(store().questionStates.q1.isVisited).toBe(true);
    unmount();
  });

  it("answering all five and marking an answered one: nothing unanswered or not visited", () => {
    store().resetAssessment();
    store().setAssessment(paper());
    const unmount = mount();
    questions.forEach((question, index) => {
      if (index > 0) act(() => store().setCurrentQuestion(question as never));
      act(() => store().setAnswer(question.question_id, [`opt-${index}`]));
    });
    act(() => store().markForReview("q3"));

    expect(summary()).toEqual({
      total: 5,
      unanswered: 0,
      counts: {
        answered: 4,
        "not-answered": 0,
        "not-visited": 0,
        marked: 0,
        "answered-marked": 1,
      },
    });
    unmount();
  });

  it("leaves a submitted attempt alone", () => {
    store().resetAssessment();
    store().setAssessment(paper());
    store().submitAssessment();
    const unmount = mount();
    expect(store().questionStates.q1.isVisited).toBe(false);
    unmount();
  });
});
