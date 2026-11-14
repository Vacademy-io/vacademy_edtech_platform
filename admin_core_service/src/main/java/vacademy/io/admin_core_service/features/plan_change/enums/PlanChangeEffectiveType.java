package vacademy.io.admin_core_service.features.plan_change.enums;

/**
 * When an approved change actually lands on the user_plan.
 *
 * <p>IMMEDIATE applies as soon as the money clears (or at once, for an admin override or a
 * zero-cost upgrade) and resets the access window to the new plan's validity.
 * END_OF_CYCLE parks the change until {@code user_plan.end_date}; the renewal path picks
 * it up, bills the new plan's price, and swaps then.
 */
public enum PlanChangeEffectiveType {
    IMMEDIATE,
    END_OF_CYCLE
}
