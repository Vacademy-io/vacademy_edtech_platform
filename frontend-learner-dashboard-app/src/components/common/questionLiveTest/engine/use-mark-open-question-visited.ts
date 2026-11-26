import { useEffect } from "react";
import { useAssessmentStore } from "@/stores/assessment-store";

/**
 * Opening a question marks it visited, on every layout, so an open question
 * with no saved answer shows as Not Answered. Navigation does this through
 * setCurrentQuestion; the first question of a freshly loaded or restored
 * paper and the question opened by a section time-up switch are set
 * directly, so they are covered here (the default screen used to leave the
 * opening question "Not visited" in its palette, the submit summary and the
 * saved attempt).
 */
export function useMarkOpenQuestionVisited() {
  const questionId = useAssessmentStore((s) => s.currentQuestion?.question_id);
  const isVisited = useAssessmentStore((s) =>
    questionId ? Boolean(s.questionStates[questionId]?.isVisited) : true,
  );
  const isSubmitted = useAssessmentStore((s) => s.isSubmitted);
  useEffect(() => {
    if (!questionId || isVisited || isSubmitted) return;
    useAssessmentStore.getState().setQuestionState(questionId, { isVisited: true });
  }, [questionId, isVisited, isSubmitted]);
}
