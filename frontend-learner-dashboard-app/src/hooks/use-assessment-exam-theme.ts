import { useEffect, useState } from "react";
import { fetchExamInterface } from "@/services/exam-interface";
import { resolveExamTheme } from "@/components/common/questionLiveTest/themes";
import type { ExamInterface, ResolvedExamTheme } from "@/types/exam-theme";

/**
 * Longest a screen waits on the exam-interface call before it stops showing
 * its loading state. A later answer is still applied.
 */
export const EXAM_THEME_LOAD_CAP_MS = 4000;

export interface AssessmentExamTheme {
  /** Raw value from the server; null = default screen or not loaded. */
  examInterface: ExamInterface | null;
  /** Resolved theme; the default theme until the fetch settles. */
  theme: ResolvedExamTheme;
  /**
   * True until the fetch settles or EXAM_THEME_LOAD_CAP_MS passes. Screens
   * keep their loading state while this is true, so a themed test does not
   * show the skinned page first and restyle it a moment later.
   */
  isLoading: boolean;
}

/**
 * Exam theme of an assessment before its attempt starts (instruction page).
 * The fetch starts on mount, in parallel with the screen's own loading.
 */
export function useAssessmentExamTheme(
  assessmentId: string | undefined
): AssessmentExamTheme {
  const [examInterface, setExamInterface] = useState<ExamInterface | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(assessmentId));

  useEffect(() => {
    if (!assessmentId) {
      setExamInterface(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setExamInterface(null);
    setIsLoading(true);
    const cap = setTimeout(() => {
      if (!cancelled) setIsLoading(false);
    }, EXAM_THEME_LOAD_CAP_MS);
    fetchExamInterface(assessmentId).then((value) => {
      clearTimeout(cap);
      if (cancelled) return;
      setExamInterface(value);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
      clearTimeout(cap);
    };
  }, [assessmentId]);

  return { examInterface, theme: resolveExamTheme(examInterface), isLoading };
}
