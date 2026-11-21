package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One media item of a social post: {@code {file_id, type, name, url}}. In requests {@code url} is
 * ignored (the server resolves it); in responses it is a public preview URL, or null when it could
 * not be resolved.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SocialPostMediaDTO {
    /** media-service file id */
    private String fileId;
    /** IMAGE | VIDEO */
    private String type;
    private String name;
    private String url;
}
