package vacademy.io.admin_core_service.features.utm_attribution.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One row of the "which campaigns produced people?" roll-up. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UtmCampaignSummaryResponse {
    private String utmSource;
    private String utmMedium;
    private String utmCampaign;
    private String sourceType;
    private long count;
}
