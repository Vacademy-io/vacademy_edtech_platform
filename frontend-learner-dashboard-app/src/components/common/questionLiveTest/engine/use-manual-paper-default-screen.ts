import { useEffect } from "react";
import { useAssessmentStore } from "@/stores/assessment-store";
import { hasExamTheme, withoutExamTheme } from "../passage-beside";

/**
 * A teacher-checked paper (evaluation MANUAL) is answered by uploading an
 * answer sheet, which only the default screen offers, and it never submits
 * itself at time-up. Any exam theme is dropped for it, so the layout, the
 * saving mode (auto) and the instructions all fall back to the default screen.
 * The default screen's own display option (passage beside the question) stays.
 */
export function useManualPaperDefaultScreen(evaluationType: string): void {
  const hasTheme = useAssessmentStore((s) => hasExamTheme(s.assessment?.exam_interface));
  useEffect(() => {
    if (evaluationType !== "MANUAL" || !hasTheme) return;
    useAssessmentStore.setState((state) =>
      state.assessment
        ? {
            assessment: {
              ...state.assessment,
              exam_interface: withoutExamTheme(state.assessment.exam_interface),
            },
            draftAnswers: {},
          }
        : {},
    );
  }, [evaluationType, hasTheme]);
}
