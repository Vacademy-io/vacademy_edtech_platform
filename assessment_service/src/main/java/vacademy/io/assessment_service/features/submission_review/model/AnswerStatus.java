package vacademy.io.assessment_service.features.submission_review.model;

import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;

/**
 * question_wise_marks.status from a mark a person gave. Moved out of
 * AdminManualEvaluationManager.deriveStatusFromMarks so every writer derives it the same way.
 */
public final class AnswerStatus {
    private AnswerStatus() {
    }

    public static String fromMarks(double marks, Double max) {
        if (marks <= 0) {
            // A teacher's 0 is a judgement (incorrect), not "unanswered".
            return QuestionResponseEnum.INCORRECT.name();
        }
        if (max != null && max > 0) {
            return marks >= max ? QuestionResponseEnum.CORRECT.name() : QuestionResponseEnum.PARTIAL_CORRECT.name();
        }
        return QuestionResponseEnum.CORRECT.name();
    }
}
