package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentException;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Money that must go back to a buyer: an order paid
 * after its hold ended with the stock gone, and a second captured payment for an order that
 * was already paid.
 *
 * <p>STUB: the refund service does not exist yet. Until it does, every case is
 * written to {@code commerce_payment_exception} (the list staff work from, one row per case,
 * however often the event is delivered) and logged as an alert. The refund work package adds the
 * {@code commerce_refund} row and the gateway refund here; the call sites stay as they are.
 *
 * <p>Called with no transaction open, after the one that marked the order has committed.
 * Never throws.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommerceRefundHook {

    private final CommercePaymentExceptionRepository exceptions;

    public void refundOversoldPaidOrder(String instituteId, String orderId, String orderNumber, BigDecimal amount,
                                        String currency) {
        record(instituteId, orderId, orderNumber, CommercePaymentException.KIND_OVERSOLD_PAID, null, null, amount,
                currency, "Paid after the hold ended and the stock was gone; the order is cancelled.");
        log.error("COMMERCE_ALERT oversold_paid_order_needs_refund institute={} order={} number={} amount={} {} "
                        + "(automatic refund is not built yet: refund by hand and tell the buyer)",
                instituteId, orderId, orderNumber, amount, currency);
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
        log.error("COMMERCE_ALERT duplicate_payment_needs_refund institute={} order={} number={} gatewayOrder={} "
                        + "payment={} amount={} {} (automatic refund is not built yet: refund by hand)",
                instituteId, orderId, orderNumber, gatewayOrderId, gatewayPaymentId, amount, currency);
    }

    private void record(String instituteId, String orderId, String orderNumber, String kind, String gatewayOrderId,
                        String gatewayPaymentId, BigDecimal amount, String currency, String detail) {
        try {
            exceptions.record(UUID.randomUUID().toString(), instituteId, orderId, orderNumber, kind, gatewayOrderId,
                    gatewayPaymentId == null ? "" : gatewayPaymentId, amount, currency, detail);
        } catch (RuntimeException e) {
            // The alert line below it is then the only record: say so.
            log.error("COMMERCE_ALERT payment_exception_not_recorded institute={} order={} kind={}", instituteId,
                    orderId, kind, e);
        }
    }
}
