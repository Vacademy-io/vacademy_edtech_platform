package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing;

import java.util.Map;

/**
 * What one graded copy is priced as: an ai_service tool key and the params its
 * estimator reads (AI_EVALUATION_PUBLIC_API.md 10.1).
 *
 * <ul>
 *   <li>Dashboard, handwritten: {@code copy_check_evaluation}, per page
 *       ({@code num_pages}); fixed price. The pages are often known only once the
 *       copy is read, so the quote at accept can be a minimum of one page;
 *       ai_service charges the pages it read.</li>
 *   <li>Dashboard, typed: {@code copy_check_evaluation}, per long answer
 *       ({@code answer_mode = TYPED}, {@code num_answers}); fixed price.</li>
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

        /** A dashboard copy: every page is billed; at least one page when the count is not known yet. */
        public static AiEvaluationCharge dashboardHandwritten(Integer pages) {
                return new AiEvaluationCharge(DASHBOARD_TOOL_KEY,
                                Map.of("num_pages", pages == null ? 1 : Math.max(1, pages)));
        }

        /** A dashboard online attempt: every written answer the AI grades is billed. */
        public static AiEvaluationCharge dashboardTyped(int answers) {
                return new AiEvaluationCharge(DASHBOARD_TOOL_KEY,
                                Map.of("answer_mode", "TYPED", "num_answers", Math.max(0, answers)));
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
