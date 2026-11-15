package vacademy.io.admin_core_service.features.commerce.stock.enums;

/** Movement types of the stock ledger. */
public enum StockMovementType {
    RECEIPT,
    ADJUSTMENT,
    DAMAGE,
    TRANSFER_OUT,
    TRANSFER_IN,
    SALE,
    POS_SALE,
    RETURN,
    PURCHASE_RETURN
}
