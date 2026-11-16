package vacademy.io.admin_core_service.features.commerce.order.payment;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.common.logging.SentryLogger;

import java.util.Collection;
import java.util.Map;

/**
 * What the legacy payment code ({@code PaymentLogService}) asks Commerce. It keeps
 * the edits in the legacy class to a test and a call:
 * <ul>
 *   <li>{@link #isCommerceLog}: one NULL-safe key read; false for every course payment;</li>
 *   <li>{@link #afterPaidCommitted}: tells the order code once the PAID claim has committed;</li>
 *   <li>{@link #refuseUnverified}: the alert for a commerce payment status that arrived
 *       outside the commerce branch of the webhook.</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommercePaymentHooks {

    private final CommercePaymentGuard guard;
    private final CommerceOrderPaymentPort orders;

    public boolean isCommerceLog(PaymentLog paymentLog) {
        return guard.isCommerceLog(paymentLog);
    }

    /** True when any of the logs is a line of a commerce order. One read per distinct group. */
    public boolean anyCommerceLog(Collection<PaymentLog> paymentLogs) {
        if (paymentLogs == null) {
            return false;
        }
        String lastGroup = null;
        for (PaymentLog paymentLog : paymentLogs) {
            String group = paymentLog == null ? null : paymentLog.getPaymentGroupId();
            if (group == null || group.equals(lastGroup)) {
                continue;
            }
            lastGroup = group;
            if (guard.orderIdOfGroup(group) != null) {
                return true;
            }
        }
        return false;
    }

    /**
     * Calls {@code CommerceOrderService.onPaymentLogPaid} after the surrounding transaction has
     * committed (at once when there is none). A failure is logged as an alert and goes no
     * further: the log is PAID and the plan ACTIVE whatever happens here, and
     * {@code ensurePaidOrderConfirmed} on the next delivery or the reconcile job confirms the
     * order.
     */
    public void afterPaidCommitted(String paymentLogId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()
                && TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    notifyPaid(paymentLogId);
                }
            });
            return;
        }
        notifyPaid(paymentLogId);
    }

    private void notifyPaid(String paymentLogId) {
        try {
            orders.onPaymentLogPaid(paymentLogId);
        } catch (Exception e) {
            log.error("COMMERCE_ALERT payment log {} is PAID but its order was not confirmed: {}",
                    paymentLogId, e.getMessage(), e);
            SentryLogger.logError(e, "Commerce order confirm after payment failed",
                    Map.of("payment.log.id", String.valueOf(paymentLogId)));
        }
    }

    /**
     * A status change for the logs of a commerce order came in outside the commerce branch of
     * the webhook. Nothing is written; the commerce branch, which compares the gateway order and
     * the amount with the order, is the only way in.
     */
    public void refuseUnverified(String orderReference, String paymentStatus, String instituteId) {
        log.error("COMMERCE_ALERT refused payment status {} for commerce order reference {} of institute {}: "
                        + "it did not come through the commerce payment check (gateway order and amount)",
                paymentStatus, orderReference, instituteId);
        SentryLogger.logError(new SecurityException("Unverified payment status for a commerce order"),
                "Commerce payment refused on the legacy path", Map.of(
                        "order.reference", String.valueOf(orderReference),
                        "payment.status", String.valueOf(paymentStatus),
                        "institute.id", String.valueOf(instituteId)));
    }
}
