package vacademy.io.admin_core_service.features.regional_pricing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RegionalPricingSettingsRequest {
    /** Null = leave as is. */
    private Boolean enabled;
    /** Null = leave as is; empty = no AUTO currencies. */
    private List<String> currencies;
}
