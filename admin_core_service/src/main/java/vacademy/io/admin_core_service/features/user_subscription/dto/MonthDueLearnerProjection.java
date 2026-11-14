package vacademy.io.admin_core_service.features.user_subscription.dto;

/** A learner on one month of the Upcoming list — the balance row plus that month's share. */
public interface MonthDueLearnerProjection extends BalanceLearnerProjection {
    /** What falls due for this learner inside the selected month. */
    Double getMonthAmount();
}
