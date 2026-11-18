package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A staff member's marks for one question of one attempt (PUT
 * admin/participants/question-marks): any question type, auto-marked or AI-marked.
 * Feedback is optional; null keeps the saved remark, blank clears it. The last four
 * fields are optional (added when the endpoint moved onto the submission-review write
 * path): absent = last write wins, a default reason after release, no email.
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
    /** Why the mark changed; recorded in the mark history. */
    private String reason;
    /** Email the learner the updated result when it is already released. */
    private Boolean notifyLearner;
    /** The answer's revision the caller saw (409 when it moved). */
    private Integer expectedRevision;
    /** The release token the caller saw, "RELEASED|ms" (409 when it moved). */
    private String expectedRelease;
}
