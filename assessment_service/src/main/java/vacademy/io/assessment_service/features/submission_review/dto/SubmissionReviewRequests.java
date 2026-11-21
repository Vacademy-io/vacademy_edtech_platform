package vacademy.io.assessment_service.features.submission_review.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionOverrideRequest;

import java.util.List;

/** Request bodies of the submission review API (snake_case JSON). */
public final class SubmissionReviewRequests {

    private SubmissionReviewRequests() {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PartMarkDto(String criterion, Double marks, Double max) {
    }

    /** A3. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record EditMarksRequest(Double marks, List<PartMarkDto> partMarks, String feedback, String reason,
                                   Boolean notifyLearner, Integer expectedRevision, String expectedRelease,
                                   Boolean preview, Boolean notAnswered,
                                   List<QuestionOverrideRequest.AnnotationEdit> annotationEdits) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record QuickMarksItem(String sectionId, String questionId, Double marks, String feedback,
                                 Boolean notAnswered, Integer expectedRevision) {
    }

    /** A3b. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record QuickMarksRequest(List<QuickMarksItem> items, String reason, Boolean notifyLearner,
                                    String expectedRelease) {
    }

    /** A3p. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AnswerPagesRequest(String answerPages) {
    }

    /** A4. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AcceptAiRequest(List<String> questionKeys, String expectedRelease,
                                  java.util.Map<String, Integer> expectedRevisions) {
        public AcceptAiRequest(List<String> questionKeys, String expectedRelease) {
            this(questionKeys, expectedRelease, null);
        }
    }

    /** A6. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReapplyKeyRequest(Boolean force, String reason, String expectedRelease) {
    }

    /** A8. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReleaseRequest(@com.fasterxml.jackson.annotation.JsonProperty("notify") Boolean sendResult,
                                 Boolean allowUnmarked, Boolean releaseWhenMarked,
                                 String expectedRelease) {
    }

    /** A9. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record WithdrawRequest(String reason) {
    }

    /** A11. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReleaseCheckRequest(List<String> attemptIds, Boolean all) {
    }
}
