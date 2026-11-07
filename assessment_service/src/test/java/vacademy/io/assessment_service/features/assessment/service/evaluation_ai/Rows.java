package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.math.BigDecimal;
import java.util.Date;

/** Builds ai_question_evaluation rows for tests. */
final class Rows {

        private Rows() {
        }

        static AiQuestionEvaluation row(String id, String questionId, String status, Integer marks,
                        Integer createdAtMillis) {
                Question q = new Question();
                q.setId(questionId);
                AiQuestionEvaluation r = new AiQuestionEvaluation();
                r.setId(id);
                r.setQuestion(q);
                r.setStatus(status);
                r.setMarksAwarded(marks == null ? null : BigDecimal.valueOf(marks));
                r.setCreatedAt(createdAtMillis == null ? null : new Date(createdAtMillis));
                return r;
        }
}
