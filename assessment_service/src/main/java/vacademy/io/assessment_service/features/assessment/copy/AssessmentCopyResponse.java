package vacademy.io.assessment_service.features.assessment.copy;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

/** The draft a copy created; the admin is sent to its wizard to review and publish it. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record AssessmentCopyResponse(
        String assessmentId,
        String name,
        String playMode,
        String status,
        int sectionCount,
        int questionCount,
        int batchCount,
        int participantCount) {
}
