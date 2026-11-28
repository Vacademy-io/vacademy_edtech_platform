package vacademy.io.admin_core_service.features.payments.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;

/**
 * Exact matching of a gateway webhook's order id to payment logs.
 *
 * <p>The gateway order id we send at checkout is either the payment log's own id or a
 * shared order id (multi-package orders: {@code MP<uuid>}), and both are stored in the
 * log's {@code payment_specific_data} as {@code originalRequest.order_id} (snake case,
 * from {@code PaymentInitiationRequestDTO}); a few older rows carry
 * {@code originalRequest.orderId}. Child logs of a multi-package order get the parent's
 * data copied in, so they match the shared id too.
 *
 * <p>A log matches when its vendor equals the webhook's gateway and the order id equals,
 * as a whole string, the log id or one of those two stored fields. The database query
 * only narrows candidates with a LIKE on the id as a complete JSON string value, with
 * {@code %}, {@code _} and the escape character escaped; this class makes the decision.
 */
public final class WebhookOrderLookup {

    /** Escape character used in the LIKE pattern built by {@link #quotedValueLikePattern}. */
    public static final char LIKE_ESCAPE = '\\';

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private WebhookOrderLookup() {
    }

    /** {@code %"<orderId>"%} with LIKE wildcards in the id escaped. */
    public static String quotedValueLikePattern(String orderId) {
        return "%\"" + escapeLike(orderId) + "\"%";
    }

    public static String escapeLike(String value) {
        StringBuilder sb = new StringBuilder(value.length() + 8);
        for (char c : value.toCharArray()) {
            if (c == '%' || c == '_' || c == LIKE_ESCAPE) {
                sb.append(LIKE_ESCAPE);
            }
            sb.append(c);
        }
        return sb.toString();
    }

    /** True when this log belongs to the gateway order {@code orderId} of {@code vendor}. */
    public static boolean matches(PaymentLog log, String orderId, String vendor) {
        if (log == null || !StringUtils.hasText(orderId) || !StringUtils.hasText(vendor)) {
            return false;
        }
        if (log.getVendor() == null || !vendor.trim().equalsIgnoreCase(log.getVendor().trim())) {
            return false;
        }
        if (orderId.equals(log.getId())) {
            return true;
        }
        return orderId.equals(storedOrderId(log.getPaymentSpecificData(), "order_id"))
                || orderId.equals(storedOrderId(log.getPaymentSpecificData(), "orderId"));
    }

    private static String storedOrderId(String paymentSpecificData, String field) {
        if (!StringUtils.hasText(paymentSpecificData)) {
            return null;
        }
        try {
            JsonNode value = MAPPER.readTree(paymentSpecificData).path("originalRequest").path(field);
            return value.isTextual() ? value.asText() : null;
        } catch (Exception e) {
            return null;
        }
    }
}
