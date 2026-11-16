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
const { useAssessmentStore } = await import("./assessment-store");
const { nextTarget } = await import(
  "@/components/common/questionLiveTest/engine/navigation-logic"
);

const question = (id: string) => ({
  question_id: id,
  question_type: "MCQS",
  question_duration: 0,
});

// A paper without section switching and without section clocks
// (whole-paper timing): its sections open one after another.
const paper = () =>
  ({
    attempt_id: "att-1",
    duration: 60,
    can_switch_section: false,
    distribution_duration: "ASSESSMENT",
    preview_total_time: 0,
    assessment_user_registration_id: "reg-1",
    exam_interface: null,
    section_dtos: [
      { id: "s1", duration: 0, question_preview_dto_list: [question("q1"), question("q2")] },
      { id: "s2", duration: 0, question_preview_dto_list: [question("q3"), question("q4")] },
    ],
  }) as never;

const store = () => useAssessmentStore.getState();

beforeEach(() => {
  store().resetAssessment();
  store().setAssessment(paper());
});

describe("sequential sections (no switching, no section clocks)", () => {
  it("Next from the last question of section 1 enters section 2 and keeps going in it", () => {
    expect(Object.keys(store().sectionTimers)).toHaveLength(0);
    const sections = store().assessment!.section_dtos;
    const step = nextTarget({ sections, currentSection: 0, currentIndex: 1, sectionTimers: {} });
    expect(step?.section).toBe(1);
    store().setCurrentSection(1);
    store().setCurrentQuestion(step!.question);
    // The store follows the learner into section 2, so the palette, the tab
    // and the next Next all belong to section 2 (they used to stay on
    // section 1 and send Next back to the first question of section 1).
    expect(store().currentSection).toBe(1);
    const after = nextTarget({ sections, currentSection: 1, currentIndex: 0, sectionTimers: {} });
    expect(after?.question.question_id).toBe("q4");
  });
});
