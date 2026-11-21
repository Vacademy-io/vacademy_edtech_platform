package vacademy.io.admin_core_service.features.regional_pricing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.math.BigDecimal;

/**
 * Admin sets a price for (plan, currency, country). An existing row with that key — AUTO or
 * MANUAL — is overwritten; otherwise a new row is created. {@code currency} may be omitted
 * for a country row, in which case the country's own currency is used.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RegionalPriceUpsertRequest {
    private String paymentPlanId;
    private String currency;
    private String countryCode;
    private BigDecimal actualPrice;
    private BigDecimal elevatedPrice;
    /**
     * true = keep the row AUTO (priced from the exchange rate) instead of MANUAL — "add a
     * country, price it automatically". actual/elevated price are then ignored.
     */
    private Boolean auto;
}
