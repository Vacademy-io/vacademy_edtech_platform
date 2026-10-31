package vacademy.io.admin_core_service.features.assignment_ai_evaluation.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssignmentAiBulkRequest {
    private String slideId;
    /** The batch of learners being viewed in Activity Stats; empty = every learner on the slide. */
    private String packageSessionId;
    /** Also check again the submissions the AI already checked (the new suggestion replaces the old). */
    private boolean includeChecked;
}
