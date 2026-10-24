package vacademy.io.admin_core_service.features.product_page.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Predefined offers on a product page — the "₹99 off on orders above ₹500" strip
 * a food-delivery app shows you.
 *
 * These are NOT coupons. A coupon is a code someone types, with its own row, its
 * own redemption limit and its own lifecycle, so its conditions live on that
 * row. An offer is part of how THIS page sells: it needs no code, applies by
 * itself, and every visitor sees the same list. That belongs with the page's
 * other selling rules in `settings_json`, which is also why it needs no schema
 * change to add one.
 *
 * Configured under `offers` in the product page's settings_json:
 *
 *   rules[]        each with the conditions it needs and the discount it gives:
 *                    minAmount     cart total at or above this, in currency units
 *                    minCourses    at least this many courses in the basket
 *                    discountType  FIXED | PERCENTAGE
 *                    discountValue the amount, or the percent
 *                    maxDiscount   ceiling for a percentage (optional)
 *                  A rule with neither condition applies to every basket.
 *
 * The BEST qualifying rule wins — never several stacked, which is what stops two
 * innocuous-looking offers from adding up to a free order. Applied after basket
 * pricing and before any coupon, so a coupon discounts what the visitor would
 * actually have paid.
 *
 * THIS IS THE AUTHORITATIVE COPY — ProductPageEnrollmentService overwrites the
 * client's amount with what this returns. offers.ts mirrors it for display and
 * the two must be changed together.
 */
@Component
@Slf4j
public class OfferCalculator {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** The offer a basket earned: how much off, and which rule gave it. */
    @Getter
    public static class AppliedOffer {
        private final double amount;
        private final String label;
        private final String id;

        AppliedOffer(double amount, String label, String id) {
            this.amount = amount;
            this.label = label;
            this.id = id;
        }
    }

    /**
     * Best qualifying offer, or null when none applies.
     *
     * @param settingsJson the product page's settings_json
     * @param amount       cart total AFTER basket pricing
     * @param courseCount  how many courses are in the basket
     */
    public AppliedOffer bestOffer(String settingsJson, double amount, int courseCount) {
        if (settingsJson == null || settingsJson.isBlank() || amount <= 0) {
            return null;
        }

        try {
            JsonNode cfg = objectMapper.readTree(settingsJson).path("offers");
            if (!cfg.path("enabled").asBoolean(false)) {
                return null;
            }
            JsonNode rules = cfg.path("rules");
            if (!rules.isArray()) {
                return null;
            }

            AppliedOffer best = null;
            for (JsonNode rule : rules) {
                if (!qualifies(rule, amount, courseCount)) {
                    continue;
                }
                double off = discountFor(rule, amount);
                if (off <= 0) {
                    continue;
                }
                if (best == null || off > best.getAmount()) {
                    best = new AppliedOffer(off, rule.path("label").asText("Offer"),
                            rule.path("id").asText(""));
                }
            }
            return best;

        } catch (Exception e) {
            // A page must stay sellable through a bad settings blob.
            log.warn("Could not read offers from product page settings: {}", e.getMessage());
            return null;
        }
    }

    private boolean qualifies(JsonNode rule, double amount, int courseCount) {
        double minAmount = rule.path("minAmount").asDouble(0);
        int minCourses = rule.path("minCourses").asInt(0);
        // Both conditions must hold when both are set — an offer for "3 courses
        // over ₹1000" means exactly that.
        return amount >= minAmount && courseCount >= minCourses;
    }

    private double discountFor(JsonNode rule, double amount) {
        double value = rule.path("discountValue").asDouble(0);
        if (value <= 0) {
            return 0;
        }
        double off = "PERCENTAGE".equalsIgnoreCase(rule.path("discountType").asText("FIXED"))
                ? amount * value / 100.0
                : value;

        JsonNode cap = rule.path("maxDiscount");
        if (!cap.isMissingNode() && cap.asDouble(0) > 0) {
            off = Math.min(off, cap.asDouble());
        }

        // Whole currency units — vendors take integer minor units — and never
        // more than the cart, so a misconfigured offer cannot mint money.
        return Math.max(0, Math.min(Math.round(off), amount));
    }
}
