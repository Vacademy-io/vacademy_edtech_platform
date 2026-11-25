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

    /** Optional note back to the learner ("granted, power cut confirmed"). */
    private String reviewNote;
}
