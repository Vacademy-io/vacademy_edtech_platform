package vacademy.io.admin_core_service.features.learner_tracking.cbe.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/**
 * The reply of both the CBE submit and my-attempts. {@code evaluation} is always present
 * (null when the answer was not graded); {@code solution} only once the learner has submitted.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CbeAttemptResponse {
    private String slideId;
    /** The activity_log row of this attempt (submit) or of the latest one (my-attempts). */
    private String activityId;
    /** 1-based number of this submission among all of the learner's submissions on the slide. */
    private Integer attemptNumber;
    private int attemptsUsed;
    private int attemptsLeft;
    private int maxAttempts;
    private long submissions;
    /** EVALUATED | EVALUATING | EVALUATION_FAILED; null when nothing was submitted yet. */
    private String responseStatus;
    private Double marks;
    private Long submittedAtMillis;
    /** The learner's answer, as submitted (my-attempts only). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private JsonNode answer;
    private JsonNode evaluation;
    /** {@code {"parts":[{"id","solution","markingScheme"}]}}, once there is a submission. */
    private JsonNode solution;
    /** Why there is no evaluation, for the learner. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String message;
    /** NO_CREDITS | EVALUATION_FAILED when the answer was saved without a grade. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String errorCode;
}
