package vacademy.io.admin_core_service.features.user_subscription.dto;

/** Overdue money in one lateness bucket (D0_30, D31_60, D61_90, D90_PLUS, UNDATED). */
public interface DashboardAgeingProjection {
    String getBucket();
    Double getAmount();
    Long getLearners();
    Integer getOldestDays();
}
