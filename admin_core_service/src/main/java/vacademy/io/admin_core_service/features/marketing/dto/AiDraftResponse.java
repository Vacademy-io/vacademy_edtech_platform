package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/** AI-written post copy: a title, a main text and per-platform versions. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AiDraftResponse {
    private String title;
    private String body;
    /** PLATFORM -> text tailored for that platform. */
    private Map<String, String> overrides;
}
