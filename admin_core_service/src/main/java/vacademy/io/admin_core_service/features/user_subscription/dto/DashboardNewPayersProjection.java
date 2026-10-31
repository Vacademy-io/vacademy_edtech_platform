package vacademy.io.admin_core_service.features.user_subscription.dto;

/** Learners whose first payment falls in the current and in the comparison window. */
public interface DashboardNewPayersProjection {
    Long getCurrentCount();
    Long getPreviousCount();
}
