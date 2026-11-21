package vacademy.io.admin_core_service.features.commerce.stock.service;

/**
 * Lets a receipt check its supplier. The supplier table comes with the accounts work (WP-60a),
 * which provides the implementation; until then no bean exists and a receipt from a supplier
 * is refused.
 */
public interface StockSupplierDirectory {

    /** True when the supplier exists, is active and belongs to the institute. */
    boolean isSupplierOf(String instituteId, String supplierId);
}
