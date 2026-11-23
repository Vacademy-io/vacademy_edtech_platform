package vacademy.io.admin_core_service.features.commerce.order.desk;

import java.math.BigDecimal;

/**
 * Where the money of a sale is posted to the books (MoneyLedgerService, WP-64). No bean exists
 * yet: the order desk resolves it through an {@code ObjectProvider}, calls it after its own
 * transaction has committed, and catches everything, so a missing or failing ledger never fails
 * a sale.
 */
public interface CommerceSalesMoneyHook {

    /** Money staff recorded as received on an order (a staff order tender, a receipt). */
    void tenderReceived(String instituteId, String orderId, String tenderId, String mode, BigDecimal amount);

    /** A pending tender was voided (cancel, line cancel, RTO of a COD order). */
    void tenderVoided(String instituteId, String orderId, String tenderId, String mode, BigDecimal amount);

    /** A courier's COD remittance was recorded (WP-31). */
    void codRemitted(String instituteId, String remittanceId, BigDecimal netAmount);

    /**
     * A refund was paid out (WP-32), whatever its method: GATEWAY, BANK_TRANSFER, UPI, CASH or
     * EXCHANGE_CREDIT (the books decide what each posts). A default, so no implementer breaks.
     */
    default void refundProcessed(String instituteId, String orderId, String refundId, String method,
                                 BigDecimal amount) {
    }
}
