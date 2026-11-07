package vacademy.io.admin_core_service.features.user_subscription.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

/**
 * "How many days is this plan good for?"
 *
 * <p>Extracted from RenewalPaymentService because the plan-change proration needs exactly
 * the same answer for exactly the same reasons: the live PaymentPlan row is authoritative,
 * but a plan retired by a later Payment Settings edit leaves {@code userPlan.paymentPlan}
 * pointing at a DELETED row (or nothing), and the only surviving record of what the learner
 * actually bought is the {@code plan_json} snapshot taken at enrollment.
 *
 * <p>The snapshot is read under both naming conventions — it has been written by both
 * camelCase and snake_case serializers over the years.
 */
@Slf4j
public final class PlanValidityResolver {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Fallback when nothing is resolvable at all. Matches the historical renewal behaviour. */
    public static final int DEFAULT_VALIDITY_DAYS = 30;

    private PlanValidityResolver() {
    }

    /**
     * Validity in days for the plan a UserPlan is on, falling back to its plan_json
     * snapshot and finally to {@link #DEFAULT_VALIDITY_DAYS}.
     */
    public static int resolveValidityDays(UserPlan userPlan) {
        Integer live = fromPlan(userPlan != null ? userPlan.getPaymentPlan() : null);
        if (live != null) {
            return live;
        }
        Integer snapshot = fromPlanJson(userPlan != null ? userPlan.getPlanJson() : null);
        if (snapshot != null) {
            return snapshot;
        }
        log.warn("No validity_in_days resolvable for UserPlan: {} — defaulting to {} days",
                userPlan != null ? userPlan.getId() : null, DEFAULT_VALIDITY_DAYS);
        return DEFAULT_VALIDITY_DAYS;
    }

    /**
     * Validity of a plan, or null when it has none. Unlike
     * {@link #resolveValidityDays(UserPlan)} this does NOT invent a default — a null here
     * means "lifetime / no expiry", which proration and end-date maths must handle
     * explicitly rather than silently treating as 30 days.
     */
    public static Integer fromPlan(PaymentPlan plan) {
        if (plan == null || plan.getValidityInDays() == null || plan.getValidityInDays() <= 0) {
            return null;
        }
        return plan.getValidityInDays();
    }

    /** Reads validityInDays / validity_in_days out of a plan_json snapshot. Null if absent. */
    public static Integer fromPlanJson(String planJson) {
        if (!StringUtils.hasText(planJson)) {
            return null;
        }
        try {
            JsonNode node = MAPPER.readTree(planJson);
            JsonNode value = node.get("validityInDays");
            if (value == null) {
                value = node.get("validity_in_days");
            }
            if (value != null && value.asInt() > 0) {
                return value.asInt();
            }
        } catch (Exception e) {
            log.debug("Could not read validityInDays from plan_json: {}", e.getMessage());
        }
        return null;
    }
}
