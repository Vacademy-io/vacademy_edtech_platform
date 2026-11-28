package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/** Where a post goes (one social account) and how that went. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SocialPostTargetDTO {
    private String id;
    private String socialAccountId;
    /** FACEBOOK | INSTAGRAM | GOOGLE_BUSINESS | YOUTUBE */
    private String platform;
    private String accountName;
    /** PENDING | PUBLISHING | POSTED | FAILED | SKIPPED */
    private String status;
    private String permalink;
    private String errorMessage;
    private Instant postedAt;
}
