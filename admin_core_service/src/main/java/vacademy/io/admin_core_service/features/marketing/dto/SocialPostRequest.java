package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Create / update body for a social post. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SocialPostRequest {

    public static final String ACTION_DRAFT = "DRAFT";
    public static final String ACTION_SUBMIT = "SUBMIT";
    public static final String ACTION_SCHEDULE = "SCHEDULE";
    public static final String ACTION_POST_NOW = "POST_NOW";

    private String title;
    private String body;
    private String linkUrl;
    /** {file_id, type, name}; url is ignored. */
    private List<SocialPostMediaDTO> media;
    /** PLATFORM -> text. */
    private Map<String, String> overrides;
    private List<String> accountIds;
    /** ISO instant; required for SCHEDULE by an admin. */
    private Instant scheduledAt;
    /** DRAFT | SUBMIT | SCHEDULE | POST_NOW */
    private String action;
    /** MANUAL (default) | AGENT */
    private String source;
}
