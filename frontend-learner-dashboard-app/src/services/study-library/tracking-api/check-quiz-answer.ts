import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { QUIZ_CHECK_ANSWER } from "@/constants/urls";
import type {
  CheckAnswerRequest,
  CheckAnswerResponse,
} from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/quiz-instant-feedback";

/**
 * Checks one quiz answer on the server without recording it. Used by study-mode quizzes
 * ("show answer after each question") whose answer key the learner app does not hold.
 */
export const checkQuizAnswer = async (
  body: CheckAnswerRequest
): Promise<CheckAnswerResponse> => {
  const response = await authenticatedAxiosInstance.post<CheckAnswerResponse>(QUIZ_CHECK_ANSWER, body);
  return response.data ?? {};
};
