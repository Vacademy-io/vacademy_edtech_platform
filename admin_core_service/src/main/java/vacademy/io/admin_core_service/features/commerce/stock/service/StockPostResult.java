package vacademy.io.admin_core_service.features.commerce.stock.service;

import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;

/**
 * What a posting did.
 *
 * @param movement          the ledger row; null when the variant is not counted (UNTRACKED)
 * @param created           false when the key had been posted before and nothing changed now
 * @param sellableShortfall units that left an online location although they were already held
 *                          or sold online; above zero means open orders are short of stock
 */
public record StockPostResult(StockMovement movement, boolean created, int sellableShortfall) {

    public static StockPostResult untracked() {
        return new StockPostResult(null, false, 0);
    }

    public static StockPostResult repeated(StockMovement movement) {
        return new StockPostResult(movement, false, 0);
    }

    public boolean isUntracked() {
        return movement == null;
    }
}
