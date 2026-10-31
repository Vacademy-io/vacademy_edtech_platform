package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing;

import java.util.Map;

/**
 * What one graded copy is priced as: an ai_service tool key and the params its
 * estimator reads (AI_EVALUATION_PUBLIC_API.md 10.1).
 *
 * <ul>
 *   <li>Dashboard: {@code copy_check_evaluation}, per question on the paper
 *       ({@code num_questions}); charged {@code max(quote, actual)} by ai_service,
 *       unchanged.</li>
 *   <li>Partner API, handwritten: {@code copy_check_evaluation_api}, per page
 *       ({@code num_pages}); fixed price.</li>
 *   <li>Partner API, typed: {@code copy_check_evaluation_api}, per non-blank long
 *       answer ({@code answer_mode = TYPED}, {@code num_answers}); fixed price.</li>
 * </ul>
 *
 * A record, so two copies of the same paper share one quote call.
 */
public record AiEvaluationCharge(String toolKey, Map<String, Object> params) {

        public static final String DASHBOARD_TOOL_KEY = "copy_check_evaluation";
        public static final String API_TOOL_KEY = "copy_check_evaluation_api";

        public AiEvaluationCharge {
                params = params == null ? Map.of() : Map.copyOf(params);
        }

        /** A dashboard copy: every question on the paper is billed (decision, 1 Oct). */
        public static AiEvaluationCharge dashboard(int questions) {
                return new AiEvaluationCharge(DASHBOARD_TOOL_KEY, Map.of("num_questions", Math.max(0, questions)));
        }

        /** A partner's handwritten copy: every page is billed. */
        public static AiEvaluationCharge apiHandwritten(int pages) {
                return new AiEvaluationCharge(API_TOOL_KEY, Map.of("num_pages", Math.max(0, pages)));
        }

        /** A partner's typed submission: every non-blank long answer is billed. */
        public static AiEvaluationCharge apiTyped(int nonBlankLongAnswers) {
                return new AiEvaluationCharge(API_TOOL_KEY,
                                Map.of("answer_mode", "TYPED", "num_answers", Math.max(0, nonBlankLongAnswers)));
        }
}
