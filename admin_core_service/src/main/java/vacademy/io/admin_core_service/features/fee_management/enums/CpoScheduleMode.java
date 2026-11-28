package vacademy.io.admin_core_service.features.fee_management.enums;

/**
 * How a CPO's per-learner installment bills are produced.
 *
 * <ul>
 *   <li>{@link #FIXED}: from the plan's aft_installments template (amounts and due dates
 *       shared by every learner on the plan). The default and the only mode before V575.</li>
 *   <li>{@link #FLEXIBLE}: the plan carries fee types and amounts only; the number of
 *       installments, the gap and the first due date are chosen per learner at enrollment
 *       (or taken from the plan's {@code flexible_defaults} when none is given).</li>
 * </ul>
 */
public enum CpoScheduleMode {
    FIXED,
    FLEXIBLE;

    public static boolean isFlexible(String value) {
        return FLEXIBLE.name().equalsIgnoreCase(value);
    }
}
