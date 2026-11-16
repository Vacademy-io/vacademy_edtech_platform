package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentException;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Money that must go back to a buyer without a person deciding: an order paid after its hold
 * ended with the stock gone, and a second captured payment for an order that was already paid.
 *
 * <p>Each case is written to {@code commerce_payment_exception} (one row per case, however often
 * the event is delivered) and then gets its refund row through the gateway (WP-32): the oversold
 * order's whole payment (its refund due is raised first), or the second payment in full. Only
 * rows are made here; the refund poll job sends them to the gateway within a minute, never the
 * webhook or payment thread. The poll also calls this hook again for a row whose refund was not
 * made (idempotent by key).
 *
 * <p>{@link #refundDue} (a cancel, line cancel, RTO or return of a paid order) writes no row: the
 * order's open due lists it in the order desk's REFUND_DUE queue, where a manager refunds it.
 *
 * <p>Called with no transaction open, after the one that marked the order has committed.
 * Never throws.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommerceRefundHook {

    private final CommercePaymentExceptionRepository exceptions;
    private final ObjectProvider<CommerceRefundService> refunds;

    public void refundOversoldPaidOrder(String instituteId, String orderId, String orderNumber, BigDecimal amount,
                                        String currency) {
        record(instituteId, orderId, orderNumber, CommercePaymentException.KIND_OVERSOLD_PAID, null, null, amount,
                currency, "Paid after the hold ended and the stock was gone; the order is cancelled.");
        try {
            CommerceRefundService service = refunds.getIfAvailable();
            String refundId = service == null ? null : service.autoOversold(instituteId, orderId);
            if (refundId != null) {
                log.info("Commerce oversold order {} ({}): refund {} made, sent by the refund poll", orderNumber,
                        orderId, refundId);
            }
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT refund_hook_failed kind=OVERSOLD_PAID institute={} order={}", instituteId,
                    orderId, e);
        }
    }

    /**
     * A captured payment arrived for an order that another payment had already paid.
     *
     * @param gatewayPaymentId the second payment, the one to give back
     */
    public void refundDuplicatePayment(String instituteId, String orderId, String orderNumber,
                                       String gatewayOrderId, String gatewayPaymentId, BigDecimal amount,
                                       String currency) {
        record(instituteId, orderId, orderNumber, CommercePaymentException.KIND_DUPLICATE_PAYMENT, gatewayOrderId,
                gatewayPaymentId, amount, currency,
                "A second captured payment for an order that was already paid.");
        try {
            CommerceRefundService service = refunds.getIfAvailable();
            String refundId = service == null ? null
                    : service.autoDuplicate(instituteId, orderId, gatewayPaymentId, amount);
            if (refundId != null) {
                log.info("Commerce order {} ({}): refund {} of the second payment {} made, sent by the refund poll",
                        orderNumber, orderId, refundId, gatewayPaymentId);
            } else {
                log.error("COMMERCE_ALERT duplicate_payment_needs_refund institute={} order={} payment={} amount={} "
                        + "{}", instituteId, orderId, gatewayPaymentId, amount, currency);
            }
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT refund_hook_failed kind=DUPLICATE_PAYMENT institute={} order={} payment={}",
                    instituteId, orderId, gatewayPaymentId, e);
        }
    }

    /**
     * The order desk raised {@code commerce_order.refund_due} (cancel, line cancel, RTO received,
     * return received). No row is written: the open due puts the order in the REFUND_DUE queue.
     * Joins the caller's transaction; never throws.
     */
    public void refundDue(String instituteId, String orderId, String orderNumber, String eventKey, BigDecimal amount,
                          String currency, String detail) {
        if (amount == null || amount.signum() <= 0) {
            return;
        }
        log.info("Commerce order {} ({}) of institute {}: {} {} due back ({}): {}", orderNumber, orderId, instituteId,
                amount, currency, eventKey, detail);
    }

    private void record(String instituteId, String orderId, String orderNumber, String kind, String gatewayOrderId,
                        String gatewayPaymentId, BigDecimal amount, String currency, String detail) {
        try {
            exceptions.record(UUID.randomUUID().toString(), instituteId, orderId, orderNumber, kind, gatewayOrderId,
                    gatewayPaymentId == null ? "" : gatewayPaymentId, amount, currency, detail);
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT payment_exception_not_recorded institute={} order={} kind={}", instituteId,
                    orderId, kind, e);
        }
    }
}
