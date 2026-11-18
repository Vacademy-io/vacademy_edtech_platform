import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { QUIZ_CBE_GRADE, QUIZ_CBE_RESULTS } from "@/constants/urls";
import type { CbeAnswer } from "@/components/cbe/types";
import type {
  CbeSlideEvaluation,
  CbeSlideSolutionPart,
} from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/cbe-slide-state";
import type { QuizCbeState } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/quiz-cbe";

/** One Spreadsheet & Written Response question of a quiz attempt (admin_core QuizCbeGradeResponse.Question). */
export type QuizCbeQuestionResult = {
  question_id: string;
  state: QuizCbeState;
  /** CORRECT | WRONG | SUBMITTED | SKIPPED */
  response_status?: string | null;
  marks?: number | null;
  max_marks?: number | null;
  evaluation?: CbeSlideEvaluation | null;
  /** Only when the quiz review may show answers to this learner. */
  solution?: { parts?: CbeSlideSolutionPart[] } | null;
  /** The learner's own answer (results only). */
  answer?: CbeAnswer | null;
  /** NO_CREDITS | EVALUATION_FAILED */
  error_code?: string | null;
  message?: string | null;
  checks_used?: number;
  max_checks?: number;
};

export type QuizCbeResults = {
  slide_id: string;
  attempt_id: string;
  show_solutions: boolean;
  questions: QuizCbeQuestionResult[];
};

/**
 * AI-checks the CBE answers of a submitted quiz attempt that are not graded yet and
 * records their marks on the attempt. Safe to repeat: graded answers come back as they are.
 * Can take up to two minutes (one AI call per answer, side by side).
 */
export const gradeQuizCbe = async (body: {
  slide_id: string;
  attempt_id: string;
  chapter_id?: string;
  package_session_id?: string;
}): Promise<QuizCbeResults> => {
  const response = await authenticatedAxiosInstance.post<QuizCbeResults>(QUIZ_CBE_GRADE, body);
  return response.data;
};

/** Where each CBE answer of an attempt stands, with the learner's own answer. Grades nothing. */
export const getQuizCbeResults = async (slideId: string, attemptId: string): Promise<QuizCbeResults> => {
  const response = await authenticatedAxiosInstance.get<QuizCbeResults>(QUIZ_CBE_RESULTS, {
    params: { slide_id: slideId, attempt_id: attemptId },
  });
  return response.data;
};
