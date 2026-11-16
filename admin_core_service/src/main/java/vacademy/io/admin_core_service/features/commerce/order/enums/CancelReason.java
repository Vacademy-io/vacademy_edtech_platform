package vacademy.io.admin_core_service.features.commerce.order.enums;

/** {@code commerce_order.cancel_reason} values written by the order desk (32 characters at most). */
public enum CancelReason {
    /** Staff cancelled the order (a phone call, an address that cannot be served). */
    STAFF_CANCELLED,
    /** Every item line was cancelled one by one. */
    LINES_CANCELLED,
    /** A cash-on-delivery order that nobody confirmed in time. */
    COD_NOT_CONFIRMED
}
