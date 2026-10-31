package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;

import java.math.BigDecimal;

/**
 * Who is asking for an AI check, and how it is priced (spec 10.6, 10.8).
 *
 * <ul>
 *   <li>{@link #dashboard()}: a teacher (or a bulk upload) on the admin dashboard.
 *       Priced per question with {@code copy_check_evaluation}; the credit check fails
 *       open; no credit limit; nothing partner-specific on the row.</li>
 *   <li>{@link #api}: a partner API key. The caller supplies the charge (per page or
 *       per typed answer, {@code copy_check_evaluation_api}), the key's credit limit and,
 *       for a copy, its page count; the credit check fails closed.</li>
 * </ul>
 *
 * @param reservation a quote already made for this copy inside the caller's
 *                    transaction (a multi-copy request reserves all its copies at once
 *                    under the institute lock); null = reserve it at enqueue
 */
public record AiEvaluationEnqueueContext(boolean apiTraffic, String apiKeyId, BigDecimal creditLimit,
                Integer pageCount, AiEvaluationCharge charge, AiEvaluationCreditGate.Reservation reservation) {

        private static final AiEvaluationEnqueueContext DASHBOARD =
                        new AiEvaluationEnqueueContext(false, null, BigDecimal.ZERO, null, null, null);

        public static AiEvaluationEnqueueContext dashboard() {
                return DASHBOARD;
        }

        public static AiEvaluationEnqueueContext api(String apiKeyId, BigDecimal creditLimit, Integer pageCount,
                        AiEvaluationCharge charge) {
                return new AiEvaluationEnqueueContext(true, apiKeyId, creditLimit, pageCount, charge, null);
        }

        public AiEvaluationEnqueueContext withReservation(AiEvaluationCreditGate.Reservation reserved) {
                return new AiEvaluationEnqueueContext(apiTraffic, apiKeyId, creditLimit, pageCount, charge, reserved);
        }

        public AiEvaluationCreditGate.Mode creditMode() {
                return apiTraffic ? AiEvaluationCreditGate.Mode.API : AiEvaluationCreditGate.Mode.DASHBOARD;
        }
}
