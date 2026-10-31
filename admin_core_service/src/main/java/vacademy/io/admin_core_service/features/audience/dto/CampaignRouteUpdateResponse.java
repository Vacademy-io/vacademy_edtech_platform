package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CampaignRouteUpdateResponse {
    private CampaignRouteDTO route;
    /** Set when the request created a new list. */
    private String createdAudienceId;
    /** Existing leads moved to the new list (when asked to move them). */
    private int movedLeads;
    /** Existing leads that could not be moved (e.g. already in the target list). */
    private int skippedLeads;
}
