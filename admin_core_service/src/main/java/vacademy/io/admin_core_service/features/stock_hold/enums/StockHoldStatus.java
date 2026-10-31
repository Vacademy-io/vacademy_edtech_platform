package vacademy.io.admin_core_service.features.stock_hold.enums;

/** Lifecycle of a {@code stock_hold} row. See V635 for the meaning of each state. */
public enum StockHoldStatus {
    HELD,
    SOLD,
    RELEASED,
    RESTORED
}
