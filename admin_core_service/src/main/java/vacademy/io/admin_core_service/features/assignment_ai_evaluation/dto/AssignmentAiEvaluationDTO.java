package vacademy.io.admin_core_service.features.assignment_ai_evaluation.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluation;

import java.time.Instant;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssignmentAiEvaluationDTO {
    private String id;
    private String trackedId;
    private String status;
    private String currentStep;
    private Double maxMarks;
    private Double marksAwarded;
    private String feedback;
    private String evaluatedFileId;
    private String errorMessage;
    private Instant createdAt;
    private Instant updatedAt;

    public static AssignmentAiEvaluationDTO from(AssignmentAiEvaluation e) {
        AssignmentAiEvaluationDTO dto = new AssignmentAiEvaluationDTO();
        dto.setId(e.getId());
        dto.setTrackedId(e.getTrackedId());
        dto.setStatus(e.getStatus());
        dto.setCurrentStep(e.getCurrentStep());
        dto.setMaxMarks(e.getMaxMarks());
        dto.setMarksAwarded(e.getMarksAwarded());
        dto.setFeedback(e.getFeedback());
        dto.setEvaluatedFileId(e.getEvaluatedFileId());
        dto.setErrorMessage(e.getErrorMessage());
        dto.setCreatedAt(e.getCreatedAt());
        dto.setUpdatedAt(e.getUpdatedAt());
        return dto;
    }
}
