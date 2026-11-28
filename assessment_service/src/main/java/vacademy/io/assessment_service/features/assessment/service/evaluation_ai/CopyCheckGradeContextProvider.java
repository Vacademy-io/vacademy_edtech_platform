package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;

/**
 * Extension point for what an exam knows beyond the dashboard's tables - the partner
 * API's exam subject, level, instructions and internal-choice groups (spec 7.1, 7.2,
 * C4). Implemented by the API facade; when no bean exists the grade request is
 * exactly the dashboard's.
 *
 * <p>Called inside the dispatch transaction, after the request is built and before it
 * is sent. Implementations must be quick (DB reads only) and must not throw for a
 * dashboard process.
 */
public interface CopyCheckGradeContextProvider {

        /** The subject to send with every question, or null to keep the default. */
        default String subject(AiEvaluationProcess process) {
                return null;
        }

        /** Fill {@code exam_context}, {@code choice_groups} or {@code paper_max} on the request. */
        default void contribute(AiEvaluationProcess process, CopyCheckGradeRequestDto request) {
        }
}
