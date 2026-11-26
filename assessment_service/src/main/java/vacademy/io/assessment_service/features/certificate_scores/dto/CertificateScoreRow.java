package vacademy.io.assessment_service.features.certificate_scores.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One learner's best final result on one assessment. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CertificateScoreRow {
    private String userId;
    private String assessmentId;
    /** Sum of the assessment's live section marks; null when it has none. */
    private Double maxMarks;
    /** Best marks across final (visible) attempts; null when there is none. */
    private Double bestMarks;
    /** bestMarks as a percentage of maxMarks, one decimal; null when either is missing. */
    private Double bestPercent;
    /** ENDED attempts whose marks the learner can see. */
    private long finalAttempts;
    /** ENDED attempts whose marks are still held for a teacher or a release. */
    private long heldAttempts;
}
