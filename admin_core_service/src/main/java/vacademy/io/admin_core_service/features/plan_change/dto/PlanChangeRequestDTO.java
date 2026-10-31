package vacademy.io.admin_core_service.features.plan_change.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/**
 * Body for both the learner "switch me to this plan" and the admin "move them to this plan"
 * calls. Deliberately carries no amount — the price and the proration are always derived
 * server-side from the target plan, never trusted from the client.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PlanChangeRequestDTO {

    private String targetPlanId;

    /**
     * Learner only. Opens the upgrade checkout in mandate mode so one approval both pays
     * and registers a fresh auto-pay mandate. Forced on by the UI when the chosen target
     * reports {@code requires_mandate_reauth}.
     */
    private boolean withAutopay;

    /**
     * Learner only, with {@code withAutopay}. How the fresh mandate is authorised —
     * {@code upi} or {@code card}, the same choice the enrol form offers. Omitted: the
     * method of the learner's existing mandate is reused, defaulting to UPI.
     */
    private String mandateMethod;

    /** Admin only. Why the plan was moved without a payment. Persisted for audit. */
    private String reason;

    /** Admin only. Send the learner a plan-changed notification. */
    private boolean notifyLearner;
}
