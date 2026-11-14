package vacademy.io.admin_core_service.features.user_subscription.dto;

/** One month (yyyy-MM) or day (yyyy-MM-dd) of a dashboard series. */
public interface DashboardSeriesProjection {
    String getBucket();
    Double getAmount();
    Long getPayments();
    Long getPayers();
}
