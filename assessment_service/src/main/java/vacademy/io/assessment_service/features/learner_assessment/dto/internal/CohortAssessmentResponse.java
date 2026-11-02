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
 * Response of the cohort assessment endpoint: the latest ENDED attempt of each learner on each
 * assessment in the window. Learners with no attempt have no rows.
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)
public class CohortAssessmentResponse {

    private List<Attempt> attempts;

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)
    public static class Attempt {
        private String userId;
        private String assessmentId;
        private String assessmentName;
        /** ISO-8601 instant. */
        private String attemptAt;
        private Double percentage;
    }
}
