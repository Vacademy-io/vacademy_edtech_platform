package vacademy.io.admin_core_service.features.regional_pricing.dto;

import java.math.BigDecimal;

/**
 * The regional price a viewer gets for one plan, resolved from payment_plan_regional_price.
 * {@code elevatedPrice} may be null (no strike-through price).
 */
public record RegionalQuote(
        String paymentPlanId,
        BigDecimal actualPrice,
        BigDecimal elevatedPrice,
        String currency,
        String countryCode,
        String priceSource,
        String regionalPriceId) {
}
