import { useEffect } from "react";
import { useAssessmentStore } from "@/stores/assessment-store";

/**
 * A teacher-checked paper (evaluation MANUAL) is answered by uploading an
 * answer sheet, which only the default screen offers, and it never submits
 * itself at time-up. Any exam theme is dropped for it, so the layout, the
 * saving mode (auto) and the instructions all fall back to the default screen.
 */
export function useManualPaperDefaultScreen(evaluationType: string): void {
  const hasExamInterface = useAssessmentStore((s) => Boolean(s.assessment?.exam_interface));
  useEffect(() => {
    if (evaluationType !== "MANUAL" || !hasExamInterface) return;
    useAssessmentStore.setState((state) =>
      state.assessment
        ? { assessment: { ...state.assessment, exam_interface: null }, draftAnswers: {} }
        : {},
    );
  }, [evaluationType, hasExamInterface]);
}
