package vacademy.io.admin_core_service.features.commerce.tax.enums;

/** Which unit value is compared with a slab limit (setting commerce.tax.slabBasis). */
public enum SlabBasis {
    /** Per unit, after every discount. The default. */
    NET_UNIT_PRICE,
    /** Per unit, before any discount. */
    LIST_UNIT_PRICE
}
