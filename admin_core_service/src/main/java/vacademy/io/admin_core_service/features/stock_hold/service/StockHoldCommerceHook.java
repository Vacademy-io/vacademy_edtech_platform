package vacademy.io.admin_core_service.features.stock_hold.service;

import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository.StockHoldRow;

/**
 * What Commerce wants to know from the hold code. The
 * order code implements it; with no implementation in the context nothing changes.
 */
public interface StockHoldCommerceHook {

    /**
     * True while a payment attempt on this order is in progress, so the public release call
     * must not free its stock. Runs inside the release transaction: read only, no remote call.
     */
    default boolean paymentInProgress(String orderPaymentLogId) {
        return false;
    }

    /**
     * A HELD row was released and its stock given back. Called after that transaction has
     * committed, once per row. An exception is logged and does not reach the release.
     *
     * @param reason {@code EXPIRED} from the expiry job, {@code SHOPPER} from the release call
     */
    default void onHoldReleased(StockHoldRow hold, String reason) {
    }
}
