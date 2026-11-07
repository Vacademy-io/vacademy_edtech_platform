package vacademy.io.admin_core_service.features.utm_attribution.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * What a capture surface reports after a SUCCESSFUL submission.
 *
 * snake_case on the wire, matching the rest of the learner app's payloads.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UtmTrackRequest {

    private String instituteId;

    /** Known for most surfaces; null is accepted and matched later on contact. */
    private String userId;
    private String email;
    private String mobileNumber;

    private String sourceType;
    private String sourceId;

    private String utmSource;
    private String utmMedium;
    private String utmCampaign;
    private String utmContent;
    private String utmTerm;

    /** Full referring URL — only the host is stored. */
    private String referrer;
    /** Landing URL — only the path is stored. */
    private String landingUrl;
}
