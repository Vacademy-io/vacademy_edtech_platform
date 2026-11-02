package vacademy.io.assessment_service.features.learner_assessment.dto.internal;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * Request body for
 * {@code POST /assessment-service/internal/student-analysis/assessment-history/cohort}:
 * a cohort (max 500 learners) and an inclusive date window (yyyy-MM-dd).
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)
public class CohortAssessmentRequest {

    private String instituteId;
    private List<String> userIds;
    private String startDate;
    private String endDate;
}
