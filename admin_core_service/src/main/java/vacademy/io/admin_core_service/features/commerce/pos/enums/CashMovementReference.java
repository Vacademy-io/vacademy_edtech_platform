package vacademy.io.admin_core_service.features.commerce.pos.enums;

/**
 * {@code pos_cash_movement.reference_type}: what a cash movement was for. The counter package
 * writes {@link #NONE} only; the other values belong to the till accounts that come later.
 */
public enum CashMovementReference {
    EXPENSE,
    SUPPLIER_PAYMENT,
    MONEY_TRANSFER,
    MONEY_VOUCHER,
    CUSTOMER_RECEIPT,
    ORDER_TENDER,
    NONE
}
