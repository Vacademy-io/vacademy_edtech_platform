package vacademy.io.admin_core_service.features.user_subscription.dto;

/**
 * One payment of the grouped Manage Payments listing, before it is loaded: its earliest
 * payment_log row (or an unpaid invoice) plus every row of the same payment that matched the
 * filters. See PaymentLogRepository#findCombinedPaymentGroupsPaginated.
 */
public interface CombinedPaymentGroupRowProjection extends CombinedPaymentRowProjection {

    /** Comma-separated ids of the payment's rows, oldest first; just {@link #getRowId()} alone. */
    String getMemberIds();
}
