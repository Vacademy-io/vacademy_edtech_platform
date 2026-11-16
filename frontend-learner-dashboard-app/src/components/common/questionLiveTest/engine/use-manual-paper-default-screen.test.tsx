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

const { useAssessmentStore, answerCommitModeOf } = await import("@/stores/assessment-store");
const { useManualPaperDefaultScreen } = await import("./use-manual-paper-default-screen");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const paper = () =>
  ({
    attempt_id: "att-1",
    duration: 60,
    can_switch_section: true,
    distribution_duration: "ASSESSMENT",
    preview_total_time: 0,
    assessment_user_registration_id: "reg-1",
    exam_interface: { v: 1, preset: "jee-advanced", strict: true },
    section_dtos: [
      {
        id: "s1",
        name: "Physics",
        duration: 30,
        question_preview_dto_list: [{ question_id: "q1", question_type: "MCQS", question_duration: 0 }],
      },
    ],
  }) as never;

function Probe({ evaluationType }: { evaluationType: string }) {
  useManualPaperDefaultScreen(evaluationType);
  return null;
}

const mount = (evaluationType: string) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe evaluationType={evaluationType} />));
  return () => act(() => root.unmount());
};

describe("useManualPaperDefaultScreen", () => {
  it("drops the exam theme of a teacher-checked paper, so saving is automatic", () => {
    useAssessmentStore.getState().resetAssessment();
    useAssessmentStore.getState().setAssessment(paper());
    expect(answerCommitModeOf(useAssessmentStore.getState())).toBe("explicit");
    const unmount = mount("MANUAL");
    expect(useAssessmentStore.getState().assessment?.exam_interface).toBeNull();
    expect(answerCommitModeOf(useAssessmentStore.getState())).toBe("auto");
    unmount();
  });

  it("keeps the default screen's passage-beside option when it drops the theme", () => {
    useAssessmentStore.getState().resetAssessment();
    const withOption = paper() as { exam_interface: unknown };
    withOption.exam_interface = { v: 1, preset: "jee-advanced", passage_beside_question: true };
    useAssessmentStore.getState().setAssessment(withOption as never);
    const unmount = mount("MANUAL");
    expect(useAssessmentStore.getState().assessment?.exam_interface).toEqual({
      passage_beside_question: true,
    });
    expect(answerCommitModeOf(useAssessmentStore.getState())).toBe("auto");
    unmount();
  });

  it("leaves a default-screen paper with the option alone", () => {
    useAssessmentStore.getState().resetAssessment();
    const standard = paper() as { exam_interface: unknown };
    standard.exam_interface = { v: 1, preset: "default", passage_beside_question: true };
    useAssessmentStore.getState().setAssessment(standard as never);
    const unmount = mount("MANUAL");
    expect(useAssessmentStore.getState().assessment?.exam_interface).toEqual({
      v: 1,
      preset: "default",
      passage_beside_question: true,
    });
    unmount();
  });

  it("keeps the exam theme of an auto-checked paper", () => {
    useAssessmentStore.getState().resetAssessment();
    useAssessmentStore.getState().setAssessment(paper());
    const unmount = mount("AUTO");
    expect(useAssessmentStore.getState().assessment?.exam_interface).toEqual({
      v: 1,
      preset: "jee-advanced",
      strict: true,
    });
    unmount();
  });
});
