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
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => undefined },
}));
vi.mock("@sentry/react", () => ({ addBreadcrumb: () => undefined }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));
// Heavy siblings this test does not look at.
vi.mock("./otherQuestionTypes/paragraph", () => ({ ExpandableParagraph: () => null }));
vi.mock("./otherQuestionTypes/CbeQuestionDisplay", () => ({
  CbeQuestionDisplay: () => <div data-testid="cbe" />,
}));
vi.mock("./otherQuestionTypes/CodingQuestionDisplay", () => ({ CodingQuestionDisplay: () => null }));

const { useAssessmentStore } = await import("@/stores/assessment-store");
const { QuestionDisplay } = await import("./question-display");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const question = (type = "MCQS", passage: string | null = "<p>The river rose.</p>") =>
  ({
    question_id: "q1",
    question_type: type,
    question_duration: 0,
    serial_number: 1,
    marking_json: "{}",
    evaluation_json: "{}",
    parent_rich_text: passage === null ? null : { id: "p1", type: "HTML", content: passage },
    question: { id: "s1", type: "HTML", content: "<p>Why did it rise?</p>" },
    options: [
      { id: "o1", text: { id: "t1", type: "HTML", content: "Rain" } },
      { id: "o2", text: { id: "t2", type: "HTML", content: "Snow" } },
    ],
  }) as never;

const load = (examInterface: unknown, q = question()) => {
  useAssessmentStore.getState().resetAssessment();
  useAssessmentStore.getState().setAssessment({
    attempt_id: "att-1",
    duration: 60,
    can_switch_section: true,
    distribution_duration: "ASSESSMENT",
    preview_total_time: 0,
    assessment_user_registration_id: "reg-1",
    exam_interface: examInterface,
    section_dtos: [{ id: "s1", name: "Reading", duration: 30, question_preview_dto_list: [q] }],
  } as never);
  useAssessmentStore.setState({ currentQuestion: q, currentSection: 0 } as never);
};

const render = () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<QuestionDisplay />));
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
};

describe("QuestionDisplay — show passage beside the question", () => {
  it("stacks the passage above the question when the option is off (today)", () => {
    load(null);
    const { host, unmount } = render();
    expect(host.querySelector('[role="separator"]')).toBeNull();
    // The collapsible stacked passage (its toggle button) is there.
    expect(host.querySelector("button[aria-expanded]")).not.toBeNull();
    expect(host.textContent).toContain("The river rose.");
    expect(host.textContent).toContain("Why did it rise?");
    unmount();
  });

  it("puts the passage in its own pane with a divider when the option is on", () => {
    load({ v: 1, preset: "default", passage_beside_question: true });
    const { host, unmount } = render();
    const divider = host.querySelector('[role="separator"]');
    expect(divider).not.toBeNull();
    expect(divider?.getAttribute("aria-label")).toBe("questionPassage.resizeLabel");
    const passagePane = host.querySelector('section[aria-label="questionPassage.label"]');
    expect(passagePane?.textContent).toContain("The river rose.");
    // The question and options sit in the other pane, not the passage pane.
    expect(passagePane?.textContent).not.toContain("Why did it rise?");
    expect(divider?.nextElementSibling?.textContent).toContain("Why did it rise?");
    expect(divider?.nextElementSibling?.querySelectorAll('[role="radio"]').length).toBe(2);
    // No stacked (collapsible) copy of the passage.
    expect(host.querySelector("button[aria-expanded]")).toBeNull();
    unmount();
  });

  it("stacks the passage when the question area is too narrow for both panes", () => {
    // A 768px tablet with the 320px question rail open leaves a 448px area.
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 448, height: 600, top: 0, left: 0, right: 448, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const g = globalThis as { ResizeObserver?: unknown };
    const hadObserver = "ResizeObserver" in g;
    const original = g.ResizeObserver;
    g.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    try {
      load({ v: 1, preset: "default", passage_beside_question: true });
      const { host, unmount } = render();
      expect(host.querySelector('[role="separator"]')).toBeNull();
      // Today's collapsible passage above the question, once, in a scroller of its own.
      expect(host.querySelectorAll("button[aria-expanded]").length).toBe(1);
      expect(host.textContent).toContain("The river rose.");
      expect(host.textContent).toContain("Why did it rise?");
      expect(host.querySelector(".overflow-auto")).not.toBeNull();
      unmount();
    } finally {
      rect.mockRestore();
      if (hadObserver) g.ResizeObserver = original;
      else delete g.ResizeObserver;
    }
  });

  it("keeps the normal layout for a question without a passage", () => {
    load({ v: 1, preset: "default", passage_beside_question: true }, question("MCQS", null));
    const { host, unmount } = render();
    expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(host.textContent).toContain("Why did it rise?");
    unmount();
  });

  it("never touches a Spreadsheet & Written Response question", () => {
    load({ v: 1, preset: "default", passage_beside_question: true }, question("CBE_RESPONSE"));
    const { host, unmount } = render();
    expect(host.querySelector('[data-testid="cbe"]')).not.toBeNull();
    expect(host.querySelector('[role="separator"]')).toBeNull();
    unmount();
  });
});
