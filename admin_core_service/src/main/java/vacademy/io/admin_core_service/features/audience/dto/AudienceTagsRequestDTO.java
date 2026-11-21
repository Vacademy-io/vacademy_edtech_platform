package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Body of {@code PUT /v1/audience/campaign/{audienceId}/tags}: the list's complete new set of
 * key -> value tags. It replaces the saved tags; an empty or missing map clears them.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AudienceTagsRequestDTO {
    private Map<String, String> tags;
}
