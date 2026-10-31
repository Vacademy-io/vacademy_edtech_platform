package vacademy.io.admin_core_service.features.plan_change.enums;

/**
 * Which way along the price axis a change moves. Direction decides the money model, not
 * the plan names: UPGRADE charges the prorated difference immediately, DOWNGRADE and
 * LATERAL are deferred to the end of the paid cycle so the learner never loses time they
 * already paid for and we never owe a refund.
 */
public enum PlanChangeDirection {
    UPGRADE,
    DOWNGRADE,
    LATERAL
}
