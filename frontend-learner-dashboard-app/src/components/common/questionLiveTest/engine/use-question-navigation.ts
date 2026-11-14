import { useCallback, useMemo } from "react";
import { useAssessmentStore } from "@/stores/assessment-store";
import type { QuestionDto } from "@/types/assessment";
import {
  canEnterSection,
  isSectionTabAvailable,
  nextTarget,
  previousTarget,
} from "./navigation-logic";

export interface QuestionNavigation {
  /** Questions of the current section. */
  sectionQuestions: QuestionDto[];
  /** Index of the open question in its section (-1 when none). */
  currentIndex: number;
  /** The current section's clock is at 0. */
  isTimeUp: boolean;
  /** The open question is the last question of the last section. */
  isLastOfTest: boolean;
  goPrev: () => void;
  goNext: () => void;
  /** Section tab click; ignored when the section may not be entered. */
  goToSection: (index: number) => void;
  isSectionTabAvailable: (index: number) => boolean;
}

/**
 * Previous, Next and section switching for the live test. The footer and the
 * section tabs only draw; these rules live here so any layout gets them.
 */
export function useQuestionNavigation(): QuestionNavigation {
  const assessment = useAssessmentStore((s) => s.assessment);
  const currentSection = useAssessmentStore((s) => s.currentSection);
  const currentQuestion = useAssessmentStore((s) => s.currentQuestion);
  const sectionTimers = useAssessmentStore((s) => s.sectionTimers);

  const sectionQuestions = useMemo(
    () =>
      assessment?.section_dtos?.[currentSection]?.question_preview_dto_list ?? [],
    [assessment, currentSection],
  );
  const currentIndex = sectionQuestions.findIndex(
    (q) => q.question_id === currentQuestion?.question_id,
  );
  const sectionCount = assessment?.section_dtos?.length ?? 0;
  const canSwitchSection = Boolean(assessment?.can_switch_section);

  const goPrev = useCallback(() => {
    const target = previousTarget(sectionQuestions, currentIndex);
    if (target) useAssessmentStore.getState().setCurrentQuestion(target);
  }, [sectionQuestions, currentIndex]);

  const goNext = useCallback(() => {
    if (!assessment?.section_dtos) return;
    const target = nextTarget({
      sections: assessment.section_dtos,
      currentSection,
      currentIndex,
      sectionTimers,
    });
    if (!target) return;
    const store = useAssessmentStore.getState();
    if (target.section !== currentSection) store.setCurrentSection(target.section);
    store.setCurrentQuestion(target.question);
  }, [assessment, currentSection, currentIndex, sectionTimers]);

  const goToSection = useCallback(
    (index: number) => {
      if (!assessment) return;
      if (!canEnterSection(canSwitchSection, index, sectionTimers, currentSection)) return;
      const store = useAssessmentStore.getState();
      store.setCurrentSection(index);
      store.setCurrentQuestion(
        assessment.section_dtos[index].question_preview_dto_list[0],
      );
    },
    [assessment, canSwitchSection, sectionTimers, currentSection],
  );

  const tabAvailable = useCallback(
    (index: number) =>
      isSectionTabAvailable(canSwitchSection, index, sectionTimers, currentSection),
    [canSwitchSection, sectionTimers, currentSection],
  );

  return useMemo(
    () => ({
      sectionQuestions,
      currentIndex,
      isTimeUp: sectionTimers[currentSection]?.timeLeft === 0,
      isLastOfTest:
        currentIndex === sectionQuestions.length - 1 &&
        currentSection === sectionCount - 1,
      goPrev,
      goNext,
      goToSection,
      isSectionTabAvailable: tabAvailable,
    }),
    [
      sectionQuestions,
      currentIndex,
      sectionTimers,
      currentSection,
      sectionCount,
      goPrev,
      goNext,
      goToSection,
      tabAvailable,
    ],
  );
}
