package vacademy.io.admin_core_service.features.utm_attribution.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;

/** One recorded touch, as the learner side-view renders it. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UtmAttributionResponse {
    private String id;
    private String sourceType;
    private String sourceId;
    private String utmSource;
    private String utmMedium;
    private String utmCampaign;
    private String utmContent;
    private String utmTerm;
    private String referrerHost;
    private String landingPath;
    private Timestamp createdAt;
}
