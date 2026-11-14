package vacademy.io.admin_core_service.features.user_subscription.dto;

/** Overdue and still-to-come for one package session (null = unassigned). */
public interface DashboardBatchBalanceProjection {
    String getPackageSessionId();
    Double getOverdue();
    Double getStillToCome();
    Long getLearners();
}
