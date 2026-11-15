package vacademy.io.admin_core_service.features.commerce.tax.enums;

/** Order line type. Only ITEM lines take a share of an order-level discount. */
public enum TaxLineType {
    ITEM,
    SHIPPING,
    COD_CHARGE
}
