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

/** A social post as the dashboard sees it, with its targets. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SocialPostDTO {
    private String id;
    private String title;
    private String body;
    private String linkUrl;
    private List<SocialPostMediaDTO> media;
    /** PLATFORM -> text that replaces body on that platform. */
    private Map<String, String> overrides;
    private Instant scheduledAt;
    /** DRAFT | NEEDS_APPROVAL | SCHEDULED | PUBLISHING | POSTED | PARTIAL | FAILED | CANCELLED */
    private String status;
    /** MANUAL | AGENT */
    private String source;
    private String createdByUserId;
    private String approvedByUserId;
    private Instant approvedAt;
    private String lastError;
    private Instant publishedAt;
    private Instant createdAt;
    private List<SocialPostTargetDTO> targets;
}
