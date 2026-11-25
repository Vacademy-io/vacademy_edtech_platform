package vacademy.io.assessment_service.features.assessment.dto.reattempt;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** What the learner's "Request Reattempt" / "Request Time Increase" dialog sends. */
@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreateReattemptRequestDto {

    private String assessmentId;

    private String instituteId;

    /** REATTEMPT, TIME_INCREASE or PROBLEM_REPORT. Defaults to REATTEMPT when absent. */
    private String requestType;

    /** Free text the learner typed. Required — the dialog disables Submit until it is filled. */
    private String reason;

    /** The attempt they were on, when the shell knows it. Optional. */
    private String attemptId;
    /**
     * PROBLEM_REPORT only: the question on screen when the learner reported. Kept only when it
     * belongs to this assessment; otherwise the report is saved without it.
     */
    private String questionId;
}
