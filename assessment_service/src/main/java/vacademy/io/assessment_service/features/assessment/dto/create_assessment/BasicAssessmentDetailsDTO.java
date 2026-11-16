package vacademy.io.assessment_service.features.assessment.dto.create_assessment;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.proctoring.dto.ProctoringConfigDTO;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BasicAssessmentDetailsDTO {
    private String status;
    private String assessmentType;
    private TestCreation testCreation;
    private LiveDateRange testBoundation;
    private Integer assessmentPreviewTime;
    private Boolean switchSections;
    private String submissionType;
    private String evaluationType;
    private Boolean raiseReattemptRequest;
    private Boolean raiseTimeIncreaseRequest;
    private Boolean hasOmrMode;
    private Integer defaultReattemptCount = 1;
    private String resultType;

    // Evaluate every submission with AI, without a teacher pressing anything (V43).
    // Null means "not sent" and leaves the stored value alone, so a partial basic-details
    // save cannot silently switch credit-spending on or off.
    private Boolean aiEvaluationEnabled;
    private String aiEvaluationModel;

    // Proctoring tier + knobs (V50). Null means "not sent" and leaves the stored
    // value alone; {"tier":"NONE"} switches it off.
    private ProctoringConfigDTO proctoringConfig;

    // Exam interface of the learner test screen (V68), e.g.
    // {"v":1,"preset":"jee-main","layout":"nta-mock","strict":true}.
    // Field absent = Java null = leave the stored value alone. An explicit JSON null
    // arrives as NullNode (Jackson's null value for JsonNode) and clears it, as does
    // preset "default". Validated and stored by ExamInterfaceService.
    private JsonNode examInterface;
    // What the student's report shows per question (V69), e.g.
    // {"show_question_wise":true,"show_your_answer":true,"show_correct_answer":false,"show_explanation":true}.
    // Field absent = leave the stored value alone; explicit JSON null (NullNode) =
    // clear it, so the institute's default report profile applies.
    private JsonNode reportOptions;
    private String source;
    private String sourceId;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TestCreation {
        private String assessmentName;
        private String subjectId;
        private String assessmentInstructionsHtml;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LiveDateRange {
        private String startDate;
        private String endDate;
    }


}
