package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/**
 * Route one campaign to a lead list: an existing list ({@code audienceId}) or a new
 * one created on the spot ({@code newList}, which wins when both are sent).
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CampaignRouteUpdateRequest {
    private String audienceId;
    private NewList newList;
    /** Also move this campaign's existing leads out of the list it fed until now. */
    private boolean moveExistingLeads;
    /**
     * The campaign's name from Google Ads. Null leaves it as is; blank clears it.
     * Sent alone (no list), it only names the campaign.
     */
    private String campaignName;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class NewList {
        private String name;
        /** Optional; defaults to the connector's main list's type. */
        private String campaignType;
    }
}
