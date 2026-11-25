package vacademy.io.assessment_service.features.assessment.dto.reattempt;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** An admin approving or rejecting one request from the inbox. */
@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReviewReattemptRequestDto {

    /** APPROVED or REJECTED; RESOLVED for a PROBLEM_REPORT. */
    private String status;

    /**
     * Attempts to grant on approval. Defaults to 1 — an admin approving without thinking about
     * the number should give one more try, not an unlimited retake.
     */
    private Integer grantedCount;

    /**
     * TIME_INCREASE only: minutes added to the learner's live attempt on approval (1 to 300).
     * Absent (an admin page built before this field): the approval is recorded and no time is
     * added, exactly as approving did before.
     */
    private Integer grantedMinutes;

    /** Optional note back to the learner ("granted, power cut confirmed"). */
    private String reviewNote;
}
