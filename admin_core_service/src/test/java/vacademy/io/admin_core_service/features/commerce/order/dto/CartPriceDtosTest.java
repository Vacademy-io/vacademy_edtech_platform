package vacademy.io.admin_core_service.features.commerce.order.dto;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.PublicDtoFields;

import java.util.Map;
import java.util.Set;

/** What the cart and pincode routes send to a shopper is exactly this list. */
class CartPriceDtosTest {

    private static final Map<String, Set<String>> ALLOWED = Map.ofEntries(
            Map.entry("Line", Set.of("lineRef", "variantId", "sku", "slug", "name", "variantLabel", "quantity", "qtyScale",
                    "qtyStep", "piece", "unit",
                    "unitPrice", "compareAtPrice", "gross", "discount", "net", "hsnCode", "taxRatePercent",
                    "taxableValue", "taxAmount")),
            Map.entry("UnavailableLine", Set.of("lineRef", "variantId", "sku", "reason", "availableQuantity",
                    "qtyStep", "maxQuantity")),
            Map.entry("Change", Set.of("lineRef", "variantId", "type", "reason", "oldUnitPrice", "newUnitPrice")),
            Map.entry("Discount", Set.of("kind", "label", "code", "amount")),
            Map.entry("Coupon", Set.of("code", "applied", "reason", "discount")),
            Map.entry("Shipping", Set.of("basis", "charge", "chargeBeforeFree", "free", "freeAbove",
                    "remainingForFree")),
            Map.entry("Cod", Set.of("eligible", "reason", "charge", "maxOrderValue", "totalWithCod",
                    "needsStaffConfirmation", "otpRequired", "pincodeChecked")),
            Map.entry("TaxRow", Set.of("ratePercent", "taxableValue", "cgst", "sgst", "igst", "cess", "taxAmount")),
            Map.entry("Tax", Set.of("head", "placeOfSupplyState", "placeOfSupplyKnown", "taxableValue", "cgst",
                    "sgst", "igst", "cess", "taxAmount", "rows")),
            Map.entry("Totals", Set.of("subtotal", "discount", "shipping", "codCharge", "roundOff", "total",
                    "lineCount")),
            Map.entry("CartPrice", Set.of("currency", "paymentMethod", "lines", "unavailable", "changes",
                    "discounts", "coupon", "shipping", "cod", "tax", "totals")),
            Map.entry("PincodeInfo", Set.of("pincode", "city", "stateCode", "stateName", "stateSource",
                    "codAllowed", "codReason", "dispatchPromise")));

    @Test
    void thePublicViewsHaveExactlyTheAllowedFields() {
        PublicDtoFields.assertExactly(CartPriceDtos.class, ALLOWED);
    }
}
