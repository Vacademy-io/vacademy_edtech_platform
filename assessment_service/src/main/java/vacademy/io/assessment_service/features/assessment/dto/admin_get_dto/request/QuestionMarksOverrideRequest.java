package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A staff member's marks for one question of one attempt, set from the
 * submission view: any question type, auto-marked or AI-marked. Feedback is
 * optional; null keeps the saved remark.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class QuestionMarksOverrideRequest {
    private String sectionId;
    private String questionId;
    private Double marks;
    private String feedback;
}
