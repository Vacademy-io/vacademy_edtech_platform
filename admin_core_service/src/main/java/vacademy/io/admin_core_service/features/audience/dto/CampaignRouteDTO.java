package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.audience.entity.AdCampaignRoute;

/** One ad campaign of a connector and the lead list its leads go to. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CampaignRouteDTO {
    private String campaignId;
    /** Null = not mapped yet: leads go to the connector's own audience. */
    private String audienceId;
    /** Admin-entered name, or null. */
    private String campaignName;
    private int leadCount;
    /** UTC, ISO without offset (the JVM runs in UTC). */
    private String firstLeadAt;
    private String lastLeadAt;
    private boolean addedManually;

    public static CampaignRouteDTO from(AdCampaignRoute r) {
        return CampaignRouteDTO.builder()
                .campaignId(r.getCampaignId())
                .audienceId(r.getAudienceId())
                .campaignName(r.getCampaignName())
                .leadCount(r.getLeadCount() != null ? r.getLeadCount() : 0)
                .firstLeadAt(r.getFirstLeadAt() != null ? r.getFirstLeadAt().toString() : null)
                .lastLeadAt(r.getLastLeadAt() != null ? r.getLastLeadAt().toString() : null)
                .addedManually(Boolean.TRUE.equals(r.getAddedManually()))
                .build();
    }
}
