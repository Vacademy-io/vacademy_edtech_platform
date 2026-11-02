package vacademy.io.assessment_service.features.assessment.dto.evaluation_ai;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QuestionEvaluationResultDto {

        @JsonProperty("question_id")
        private String questionId;

        @JsonProperty("question_number")
        private Integer questionNumber;

        @JsonProperty("status")
        private String status;

        // Results
        @JsonProperty("marks_awarded")
        private BigDecimal marksAwarded;

        @JsonProperty("max_marks")
        private BigDecimal maxMarks;

        @JsonProperty("feedback")
        private String feedback;

        @JsonProperty("extracted_answer")
        private String extractedAnswer;

        // Only the criteria breakdown details (avoiding redundancy)
        @JsonProperty("evaluation_details_json")
        private JsonNode evaluationDetailsJson;

        // copy-check fields — surfaced top-level for the FE annotation overlay.
        // For legacy (non-copy-check) evaluations these stay null; the FE
        // already reads from evaluation_details_json in that case.
        @JsonProperty("annotations")
        private List<JsonNode> annotations;

        @JsonProperty("criteria_breakdown")
        private List<JsonNode> criteriaBreakdown;

        // The teacher's edits to the AI's pen notes ({style, target, page_id, text,
        // action DELETE|EDIT, new_text}); applied when the checked copy is re-drawn.
        @JsonProperty("annotation_edits")
        private List<JsonNode> annotationEdits;

        @JsonProperty("rubric_version")
        private Integer rubricVersion;

        @JsonProperty("confidence")
        private Double confidence;

        // Why automatic grading failed (exception class + message, admin-facing;
        // set only when status is FAILED). Without this on the wire, "AI could
        // not grade this" is diagnosable only from ai_service pod logs.
        @JsonProperty("error_detail")
        private String errorDetail;

        // True once a teacher has overridden this question on the review page.
        @JsonProperty("is_edited")
        private Boolean isEdited;

        @JsonProperty("edited_at")
        private Date editedAt;

        // Timestamps
        @JsonProperty("started_at")
        private Date startedAt;

        @JsonProperty("completed_at")
        private Date completedAt;
}
