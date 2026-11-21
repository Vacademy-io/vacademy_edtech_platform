package vacademy.io.admin_core_service.features.commerce.order.payment;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;

/**
 * The calls the payment code makes into the order code, in one place. The order service
 * is looked up when it is first needed, not injected: it depends on the payment-log and plan
 * services, which in turn reach this class, and a direct reference would close that circle.
 *
 * <p>All are idempotent on the order side. None is called inside a transaction of the
 * payment code.
 */
@Component
@RequiredArgsConstructor
public class CommerceOrderPaymentPort {

    private final ObjectProvider<CommerceOrderService> orderService;

    /** A payment log of an order was claimed PAID and that transaction has committed. */
    public void onPaymentLogPaid(String paymentLogId) {
        orderService.getObject().onPaymentLogPaid(paymentLogId);
    }

    /** The hold time of an unpaid order is over. */
    public void onHoldExpired(String commerceOrderId) {
        orderService.getObject().onHoldExpired(commerceOrderId);
    }

    /** The shopper gave the stock of an unpaid order back (closed the payment window). */
    public void onShopperReleased(String commerceOrderId) {
        orderService.getObject().onShopperReleased(commerceOrderId);
    }

    /** Confirm a paid order whose confirm step did not run or failed. */
    public void ensurePaidOrderConfirmed(String commerceOrderId) {
        orderService.getObject().ensurePaidOrderConfirmed(commerceOrderId);
    }
}
