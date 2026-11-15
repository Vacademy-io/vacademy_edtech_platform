package vacademy.io.admin_core_service.features.commerce.order.payment;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService.Outcome;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService.Result;

import java.util.Optional;

/**
 * The commerce branch at the top of the Razorpay webhook. It runs
 * after the signature was verified and before any legacy routing.
 *
 * <p>The decision is made from rows. The payment entity names the gateway order it was made
 * on ({@code order_id}); when that is a {@code commerce_gateway_order} the event is a commerce
 * event, whatever its notes say. The notes are read for one thing only: when they name a
 * commerce order (or a payment log of one) but the payment was made on some other gateway
 * order, the event is refused.
 *
 * <p>For a course payment the whole branch is {@link CommercePaymentGuard#webhookMatch}: one
 * statement of key reads that finds nothing.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommerceWebhookBranch {

    private static final String SOURCE = "webhook";

    private final CommercePaymentGuard guard;
    private final CommerceGatewayOrderRepository gatewayOrders;
    private final CommercePaymentConfirmService confirmService;

    /**
     * @param entity      the payment entity of the event, or the order entity of an event that
     *                    carries no payment
     * @param instituteId the institute whose webhook secret verified the signature
     */
    public Result handle(String eventType, JsonNode entity, String instituteId) {
        if (entity == null) {
            return Result.NOT_COMMERCE;
        }
        String gatewayOrderId = gatewayOrderIdOf(entity);
        String reference = text(entity.path("notes").path("orderId"));
        CommercePaymentGuard.WebhookMatch match = guard.webhookMatch(
                CommercePaymentConfirmService.VENDOR_RAZORPAY, gatewayOrderId, reference);
        if (match.none()) {
            return Result.NOT_COMMERCE;
        }
        String paymentId = paymentIdOf(entity);
        if (match.gatewayRowId() == null) {
            // The notes name a commerce order; the payment was made on a gateway order that is
            // not one of ours. No status of that order may change.
            CommerceGatewayOrder named = new CommerceGatewayOrder();
            named.setCommerceOrderId(match.namedOrderId());
            named.setGatewayOrderId(gatewayOrderId);
            return confirmService.refuse(CommercePaymentConfirmService.REASON_ORDER_MISMATCH, named, instituteId,
                    paymentId, SOURCE, "event " + eventType + " names a commerce order in its notes but was paid "
                            + "on a gateway order that does not belong to it");
        }
        Optional<CommerceGatewayOrder> row = gatewayOrders.findById(match.gatewayRowId());
        if (row.isEmpty()) {
            return Result.NOT_COMMERCE;
        }
        CommerceGatewayOrder gatewayOrder = row.get();
        if (match.namedOrderId() != null && !match.namedOrderId().equals(gatewayOrder.getCommerceOrderId())) {
            log.warn("Commerce webhook: the notes name order {} but gateway order {} belongs to order {}; "
                            + "the gateway order decides", match.namedOrderId(), gatewayOrderId,
                    gatewayOrder.getCommerceOrderId());
        }
        if (eventType == null) {
            return new Result(Outcome.HANDLED, gatewayOrder.getCommerceOrderId(), null, 0);
        }
        switch (eventType) {
            case "payment.captured":
            case "order.paid":
                return confirmService.confirmPaid(gatewayOrder, instituteId, paidAmountOf(entity),
                        text(entity.path("currency")), paymentId, SOURCE);
            case "payment.failed":
                return confirmService.markFailed(gatewayOrder, instituteId, paymentId, SOURCE);
            case "payment.authorized":
                return confirmService.markAuthorized(gatewayOrder, instituteId, paymentId, SOURCE);
            default:
                log.info("Commerce webhook: event {} for order {} needs no action", eventType,
                        gatewayOrder.getCommerceOrderId());
                return new Result(Outcome.HANDLED, gatewayOrder.getCommerceOrderId(), null, 0);
        }
    }

    /**
     * The institute of a commerce gateway order, for an event whose notes carry no institute
     * (a payment made on our order with a checkout that passed no notes). The webhook then
     * verifies the signature with that institute's secret, as for any other event. Null when
     * the gateway order is not ours.
     */
    public String instituteOfGatewayOrder(JsonNode entity) {
        String gatewayOrderId = entity == null ? null : gatewayOrderIdOf(entity);
        if (gatewayOrderId == null) {
            return null;
        }
        return gatewayOrders.findByVendorAndGatewayOrderId(CommercePaymentConfirmService.VENDOR_RAZORPAY,
                gatewayOrderId).map(CommerceGatewayOrder::getInstituteId).orElse(null);
    }

    /** A payment entity names its order in {@code order_id}; an order entity is the order. */
    static String gatewayOrderIdOf(JsonNode entity) {
        String orderId = text(entity.path("order_id"));
        if (orderId != null) {
            return orderId;
        }
        String id = text(entity.path("id"));
        return id != null && id.startsWith("order_") ? id : null;
    }

    private static String paymentIdOf(JsonNode entity) {
        String id = text(entity.path("id"));
        return id != null && id.startsWith("order_") ? null : id;
    }

    /**
     * What was paid, in minor units: {@code amount} of a payment entity, {@code amount_paid} of
     * an order entity. Null when the event carries no number; the confirm step then refuses,
     * because -1 equals no order amount.
     */
    private static Long paidAmountOf(JsonNode entity) {
        boolean orderEntity = text(entity.path("order_id")) == null;
        JsonNode amount = orderEntity ? entity.path("amount_paid") : entity.path("amount");
        return amount.isIntegralNumber() ? amount.asLong() : Long.valueOf(-1L);
    }

    private static String text(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        String value = node.asText();
        return value == null || value.isBlank() ? null : value.trim();
    }
}
