package vacademy.io.admin_core_service.features.regional_pricing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.List;

/** Everything the admin "Regional pricing" panel of one payment option needs. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RegionalPricingConfigDTO {
    private String paymentOptionId;
    private Boolean enabled;
    private List<String> currencies;
    /** When the exchange rates behind AUTO rows were last fetched; null = never. */
    private Date ratesFetchedAt;
    private List<PlanPrices> plans;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PlanPrices {
        private String paymentPlanId;
        private String name;
        private Double baseActualPrice;
        private Double baseElevatedPrice;
        private String baseCurrency;
        private List<RegionalPriceDTO> regionalPrices;
    }
}
