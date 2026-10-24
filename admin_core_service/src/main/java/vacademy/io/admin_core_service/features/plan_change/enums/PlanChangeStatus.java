package vacademy.io.admin_core_service.features.plan_change.enums;

import java.util.List;

/**
 * Lifecycle of one change request.
 *
 * <pre>
 *   upgrade:   PENDING_PAYMENT --(webhook PAID)--> APPLIED
 *                              --(webhook FAILED)-> FAILED
 *   downgrade: SCHEDULED       --(renewal)-------> APPLIED
 *                              --(learner cancels)-> CANCELLED
 *   admin:                     ------------------> APPLIED (straight to it, no money)
 * </pre>
 */
public enum PlanChangeStatus {
    PENDING_PAYMENT,
    SCHEDULED,
    APPLIED,
    FAILED,
    CANCELLED;

    /**
     * The statuses that block a second request on the same plan. A learner may only have
     * one change in flight at a time — otherwise two pending upgrades could both clear and
     * the second would apply on top of a user_plan the first already moved.
     */
    public static List<String> openStatuses() {
        return List.of(PENDING_PAYMENT.name(), SCHEDULED.name());
    }
}
