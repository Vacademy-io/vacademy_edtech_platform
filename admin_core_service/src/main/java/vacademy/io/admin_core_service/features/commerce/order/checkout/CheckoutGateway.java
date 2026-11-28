package vacademy.io.admin_core_service.features.commerce.order.checkout;

import java.util.Map;

/**
 * What checkout needs from the payment gateway: one order to pay. The Spring implementation
 * ({@link CommerceGatewayAdapter}) hands the call to {@code CommercePaymentGateway}; tests put
 * a stub here. It is always called with no database transaction open.
 */
public interface CheckoutGateway {

    record GatewayOrderRef(String vendor, String gatewayOrderId, String keyId, long amountMinor, String currency) {
    }

    GatewayOrderRef createOrder(String instituteId, String commerceOrderId, long amountMinor, String currency,
                                String receipt, Map<String, String> notes);
}
