package vacademy.io.admin_core_service.features.learner_tracking.cbe.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/**
 * {@code POST .../question-slide/cbe/submit}. The learner is the token holder; there is no
 * user id here on purpose. {@code answer} is {@code {"parts": {"<partId>": {...}}}}
 * (docs/CBE_RESPONSE_QUESTION.md section 4).
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CbeSubmitRequest {
    private String slideId;
    private String chapterId;
    private String moduleId;
    private String subjectId;
    private String packageSessionId;
    private JsonNode answer;
    /** Optional: when the learner opened the slide, for the activity log. */
    private Long startTimeInMillis;
}
