package vacademy.io.assessment_service.features.assessment.dto.evaluation_ai;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckConfig;

import java.util.List;
import java.util.Map;

/**
 * Outbound payload to ai_service POST /copy-check/grade.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CopyCheckGradeRequestDto {

    @JsonProperty("process_id")
    private String processId;

    @JsonProperty("attempt_id")
    private String attemptId;

    @JsonProperty("assessment_id")
    private String assessmentId;

    @JsonProperty("institute_id")
    private String instituteId;

    /** COPY (default on ai_service) = scanned sheet at pdf_url; TYPED = online answers in student_answer. */
    @JsonProperty("answer_mode")
    private String answerMode;

    @JsonProperty("pdf_url")
    private String pdfUrl;

    @JsonProperty("preferred_model")
    private String preferredModel;

    @JsonProperty("callback_base_url")
    private String callbackBaseUrl;

    @JsonProperty("questions")
    private List<QuestionInput> questions;

    /** OUTSIDE = remarks in a panel beside the copy; null keeps them on the copy. */
    @JsonProperty("comment_placement")
    private String commentPlacement;

    /**
     * The assessment's own AI checking settings, read while the request is built;
     * dispatch merges the institute default into exam_context. Never sent.
     */
    @JsonIgnore
    private CopyCheckConfig.Settings copyCheckSettings;

    // ---- Partner API fields (AI_EVALUATION_PUBLIC_API.md 10.3, 10.8, C4). All null on
    // ---- dashboard runs, and NON_NULL keeps them out of the JSON, so a dashboard
    // ---- request is byte-for-byte what it was.

    /** Who the run is billed to: {@code apikey:<key_id>} for partner API traffic. */
    @JsonProperty("billing_actor")
    private String billingActor;

    /**
     * The rate the copy was quoted at when it was accepted:
     * {tool_key, flat_base_credits, per_unit_credits, unit_field, params, rate_source}.
     * ai_service charges at this rate instead of re-pricing at completion.
     */
    @JsonProperty("rate_snapshot")
    private Map<String, Object> rateSnapshot;

    /** Pages of the uploaded copy (per-page API billing). */
    @JsonProperty("page_count")
    private Integer pageCount;

    /** {level, subject, instructions, answer_language} for the grader persona. */
    @JsonProperty("exam_context")
    private Map<String, Object> examContext;

    /** Internal choice: [{question_ids, attempt, policy}]. */
    @JsonProperty("choice_groups")
    private List<Map<String, Object>> choiceGroups;

    /** The paper's total marks when internal choice makes it less than the sum of questions. */
    @JsonProperty("paper_max")
    private Double paperMax;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class QuestionInput {

        @JsonProperty("question_id")
        private String questionId;

        @JsonProperty("question_text")
        private String questionText;

        @JsonProperty("question_type")
        private String questionType;

        @JsonProperty("max_marks")
        private Double maxMarks;

        @JsonProperty("subject")
        private String subject;

        /** 1-based position in the paper's order (section, then question). */
        @JsonProperty("question_number")
        private Integer questionNumber;

        /**
         * The number the student sees printed next to this question — "2", "3(a)",
         * "Q7" — which may repeat across sections. Without it the grader was told
         * the question's UUID was "the number on the paper" and had to guess where
         * the answer sat from the wording alone.
         */
        @JsonProperty("paper_label")
        private String paperLabel;

        /** Section heading as printed ("Section B", "Passage II"), when known. */
        @JsonProperty("section")
        private String section;

        @JsonProperty("options")
        private List<Map<String, Object>> options;

        @JsonProperty("correct_answer")
        private String correctAnswer;

        /** TYPED mode only: what the learner typed for this question. */
        @JsonProperty("student_answer")
        private String studentAnswer;

        /** TYPED mode only: the answer the teacher wrote on the question, as a reference. */
        @JsonProperty("model_answer")
        private String modelAnswer;
    }
}
