package vacademy.io.admin_core_service.features.user_subscription.dto;

/** One slice of collected money: TOTAL, or a SOURCE / METHOD / BATCH bucket. */
public interface DashboardBreakdownProjection {
    String getDimension();
    /** Source kind, payment vendor or package session id; null for TOTAL and for unassigned batches. */
    String getBucketKey();
    Double getAmount();
    Long getPayments();
    Long getPayers();
}
