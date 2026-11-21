package vacademy.io.admin_core_service.features.assignment_ai_evaluation.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssignmentAiEvaluationTriggerRequest {
    private String trackedId;
}
