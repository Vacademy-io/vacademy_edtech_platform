package vacademy.io.admin_core_service.features.user_subscription.dto;

/**
 * Totals across live instalment (CPO) plans only. See
 * {@code UserPlanRepository.getInstalmentProgress}.
 */
public interface InstalmentProgressProjection {
    /** Sum of every instalment's expected amount. */
    Double getBilled();
    /** Sum of what has been paid against those instalments. */
    Double getPaid();
    /** Unpaid on instalments whose due date has passed. */
    Double getOverdue();
    /** Unpaid on every instalment, whatever its due date. */
    Double getOutstanding();
    Long getPlans();
    Long getLearners();
}
