package vacademy.io.admin_core_service.features.platform_billing.enums;

/**
 * Lifecycle of a Razorpay order placed against the platform's account
 * (mirrors {@code payment_log.status} for the institute-marketplace flow).
 */
public enum PlatformPaymentStatus {
    INITIATED,
    SUCCESS,
    FAILED,
    /** V590: the order's Payment Link expired unpaid (set by the reconcile job). */
    EXPIRED
}
