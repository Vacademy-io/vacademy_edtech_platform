package vacademy.io.admin_core_service.features.commerce.order.dto;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.PublicDtoFields;

import java.util.Map;
import java.util.Set;

/** What the checkout and order routes send to a shopper is exactly this list. */
class CheckoutDtosTest {

    private static final Map<String, Set<String>> ALLOWED = Map.ofEntries(
            Map.entry("Placed", Set.of("orderId", "orderNumber", "status", "paymentStatus", "currency", "total",
                    "payment", "paymentRetryable", "paymentProcessing", "hold", "orderAccessToken",
                    "orderAccessTokenExpiresAt", "replayed")),
            Map.entry("Payment", Set.of("vendor", "gatewayOrderId", "keyId", "amountMinor", "currency")),
            Map.entry("Hold", Set.of("paymentLogId", "releaseToken", "expiresAt")),
            Map.entry("OrderView", Set.of("orderId", "orderNumber", "status", "paymentStatus", "paymentMethod",
                    "cancelReason", "placedAt", "holdExpiresAt", "paymentRetryable", "paymentProcessing", "currency",
                    "lines", "totals", "recipient", "timeline", "masked")),
            Map.entry("OrderLineView", Set.of("lineRef", "name", "variantLabel", "sku", "quantity", "qtyScale",
                    "unit", "unitPrice", "compareAtPrice", "discount", "lineTotal", "qtyCancelled", "qtyShipped")),
            Map.entry("Totals", Set.of("subtotal", "discount", "shipping", "codCharge", "tax", "roundOff", "total",
                    "amountPaid")),
            Map.entry("Recipient", Set.of("name", "phoneMasked", "city", "stateCode", "pincode")),
            Map.entry("TimelineEntry", Set.of("status", "at")),
            Map.entry("OrderSummary", Set.of("orderId", "orderNumber", "status", "paymentStatus", "placedAt",
                    "currency", "total", "itemCount", "firstItemName", "orderAccessToken", "masked")),
            // "phone": the number the caller proved, answered only to that caller.
            Map.entry("Account", Set.of("name", "phone", "phoneMasked", "emailMasked", "marketingConsent",
                    "sessionExpiresAt")),
            Map.entry("OrderPage", Set.of("orders", "page", "pageSize", "total")),
            Map.entry("AddressView", Set.of("id", "label", "name", "phone", "line1", "line2", "landmark", "city",
                    "stateCode", "pincode", "isDefault")));

    @Test
    void thePublicViewsHaveExactlyTheAllowedFields() {
        PublicDtoFields.assertExactly(CheckoutDtos.class, ALLOWED);
    }
}
