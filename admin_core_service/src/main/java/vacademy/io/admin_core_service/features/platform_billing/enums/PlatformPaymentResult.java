package vacademy.io.admin_core_service.features.platform_billing.enums;

/**
 * Razorpay-side payment outcome (mirrors {@code payment_log.payment_status}).
 *
 * Lifecycle:
 *   PAYMENT_PENDING -> PAID                (on payment.captured)
 *                   -> FAILED              (on payment.failed)
 *   PAID            -> PARTIALLY_REFUNDED  (on first partial refund.processed)
 *                   -> REFUNDED            (when total refunded == captured)
 *   PAYMENT_PENDING -> EXPIRED             (link expire_by passed unpaid; V590)
 */
public enum PlatformPaymentResult {
    PAYMENT_PENDING,
    PAID,
    FAILED,
    PARTIALLY_REFUNDED,
    REFUNDED,
    /** V590: the Payment Link expired with nothing paid. */
    EXPIRED
}
