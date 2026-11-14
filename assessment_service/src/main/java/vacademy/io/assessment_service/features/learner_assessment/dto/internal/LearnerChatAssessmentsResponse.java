package vacademy.io.assessment_service.features.learner_assessment.dto.internal;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentBasicAssessmentListItemDto;

import java.util.List;

/**
 * The learner's open and upcoming tests, exactly as the learner app's examination page lists
 * them. Returned by {@code GET /assessment-service/internal/learner-chat/v1/assessments}.
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerChatAssessmentsResponse {
    /** Open now: the window has started and not ended. */
    private List<StudentBasicAssessmentListItemDto> live;
    /** Window not started yet. */
    private List<StudentBasicAssessmentListItemDto> upcoming;
}
