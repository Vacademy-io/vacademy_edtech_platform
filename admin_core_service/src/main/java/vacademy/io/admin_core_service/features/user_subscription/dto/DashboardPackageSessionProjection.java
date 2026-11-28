package vacademy.io.admin_core_service.features.user_subscription.dto;

/** Display names of a package session (batch) and its course. */
public interface DashboardPackageSessionProjection {
    String getPackageSessionId();
    String getPackageId();
    String getPackageName();
    String getLevelName();
    String getSessionName();
}
