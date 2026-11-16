package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGateway;

import java.util.Map;

/** Checkout's gateway port on top of the payments package's {@link CommercePaymentGateway}. */
@Component
@RequiredArgsConstructor
public class CommerceGatewayAdapter implements CheckoutGateway {

    private final CommercePaymentGateway gateway;

    @Override
    public GatewayOrderRef createOrder(String instituteId, String commerceOrderId, long amountMinor, String currency,
                                       String receipt, Map<String, String> notes) {
        var created = gateway.createOrder(instituteId, commerceOrderId, amountMinor, currency, receipt, notes);
        if (created == null) {
            return null;
        }
        return new GatewayOrderRef(created.vendor(), created.gatewayOrderId(), created.keyId(),
                created.amountMinor(), created.currency());
    }
}
