package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** A connector's campaigns and where each one's leads go. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CampaignRoutesResponse {
    /** The connector's own audience: where unmapped campaigns' leads go (the catch-all). */
    private String mainAudienceId;
    private List<CampaignRouteDTO> routes;
    /** New campaigns get their own list on their first lead. */
    private boolean autoCreateLists;
}
