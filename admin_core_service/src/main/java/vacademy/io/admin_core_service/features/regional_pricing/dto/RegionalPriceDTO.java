package vacademy.io.admin_core_service.features.regional_pricing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.regional_pricing.entity.PaymentPlanRegionalPrice;

import java.math.BigDecimal;
import java.util.Date;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RegionalPriceDTO {
    private String id;
    private String paymentPlanId;
    private String currency;
    /** Null = every country using {@link #currency}. */
    private String countryCode;
    private BigDecimal actualPrice;
    private BigDecimal elevatedPrice;
    /** AUTO | MANUAL */
    private String priceSource;
    /** MANUAL row whose plan's base price changed after it was set. */
    private Boolean needsReview;
    private BigDecimal basePriceAtCompute;
    private String baseCurrency;
    private BigDecimal fxRateUsed;
    private Date computedAt;

    public static RegionalPriceDTO from(PaymentPlanRegionalPrice row) {
        return RegionalPriceDTO.builder()
                .id(row.getId())
                .paymentPlanId(row.getPaymentPlanId())
                .currency(row.getCurrency())
                .countryCode(row.getCountryCode())
                .actualPrice(row.getActualPrice())
                .elevatedPrice(row.getElevatedPrice())
                .priceSource(row.getPriceSource())
                .needsReview(row.isNeedsReview())
                .basePriceAtCompute(row.getBasePriceAtCompute())
                .baseCurrency(row.getBaseCurrency())
                .fxRateUsed(row.getFxRateUsed())
                .computedAt(row.getComputedAt())
                .build();
    }
}
