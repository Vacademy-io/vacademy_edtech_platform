package vacademy.io.admin_core_service.features.stock_hold.enums;

/** What a {@code stock_hold} row is for. See V635. */
public enum StockHoldKind {
    /** Stock for the plan's own package session(s). */
    PURCHASE,
    /** A book picked at rent checkout, held until an admin assigns it. */
    RENT_PREFERENCE
}
