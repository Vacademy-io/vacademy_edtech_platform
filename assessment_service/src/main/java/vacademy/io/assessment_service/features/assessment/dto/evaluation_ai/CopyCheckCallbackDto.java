package vacademy.io.assessment_service.features.assessment.dto.evaluation_ai;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Parent container for all callback payloads ai_service POSTs back into
 * /copy-check/callback/{progress,question,complete,failed}. Each endpoint
 * uses one of the inner classes — Spring's @RequestBody picks the right one
 * based on the controller method signature.
 */
public class CopyCheckCallbackDto {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Progress {
        @JsonProperty("process_id")
        private String processId;

        @JsonProperty("job_id")
        private String jobId;

        @JsonProperty("step")
        private String step;

        @JsonProperty("progress")
        private Double progress;

        @JsonProperty("layout_map")
        private JsonNode layoutMap;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QuestionAnnotation {
        @JsonProperty("target")
        private String target;

        @JsonProperty("page_id")
        private String pageId;

        @JsonProperty("style")
        private String style;

        @JsonProperty("text")
        private String text;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QuestionDone {
        @JsonProperty("process_id")
        private String processId;

        @JsonProperty("job_id")
        private String jobId;

        @JsonProperty("question_id")
        private String questionId;

        @JsonProperty("marks_awarded")
        private Double marksAwarded;

        @JsonProperty("max_marks")
        private Double maxMarks;

        @JsonProperty("feedback")
        private String feedback;

        @JsonProperty("extracted_answer")
        private String extractedAnswer;

        @JsonProperty("criteria_breakdown")
        private List<JsonNode> criteriaBreakdown;

        @JsonProperty("annotations")
        private List<QuestionAnnotation> annotations;

        @JsonProperty("confidence")
        private Double confidence;

        @JsonProperty("rubric_version")
        private Integer rubricVersion;

        // Per-question outcome from the grader: COMPLETED (graded) or FAILED
        // (grading failed after retry). Null is treated as COMPLETED for
        // backward-compat with older ai_service builds.
        @JsonProperty("status")
        private String status;

        // Why grading failed, when status is FAILED — exception class and
        // message, never a stack trace. Persisted on the evaluation row so the
        // next failure is diagnosable from the API instead of ai_service pod
        // logs. Admin-facing only; the student-visible text stays in `feedback`.
        @JsonProperty("error_detail")
        private String errorDetail;

        // Machine reason of a FAILED question (budget_exhausted, max_marks_missing,
        // ai_timeout, ai_unparseable, ai_rate_limited, ai_error; spec 8.3). Null from
        // older ai_service builds.
        @JsonProperty("error_code")
        private String errorCode;

        // False when a choice group (internal choice) leaves this answer out of the
        // total (contract C4). Null from older builds = counted.
        @JsonProperty("counted")
        private Boolean counted;

        // Why the engine wants a human to look (enforcement changed the marks, duplicate
        // answer, unmapped region; spec 7.8). Read back from evaluation_result_json by the
        // partner API's needs_review rule. Omitted when absent, so the stored JSON of older
        // builds' callbacks is unchanged.
        @JsonProperty("review_reasons")
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
        private List<String> reviewReasons;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Complete {
        @JsonProperty("process_id")
        private String processId;

        @JsonProperty("job_id")
        private String jobId;

        @JsonProperty("total_marks_awarded")
        private Double totalMarksAwarded;

        @JsonProperty("total_max_marks")
        private Double totalMaxMarks;

        @JsonProperty("questions_evaluated")
        private Integer questionsEvaluated;

        // media-service fileId of the annotated copy ai_service rendered. Null
        // when rendering or upload failed — treat as "no new copy", never as
        // "clear the existing one".
        @JsonProperty("evaluated_file_id")
        private String evaluatedFileId;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Failed {
        @JsonProperty("process_id")
        private String processId;

        @JsonProperty("job_id")
        private String jobId;

        @JsonProperty("error_message")
        private String errorMessage;

        // Machine reason (spec 8.3: copy_unreadable, language_not_supported, ...). Null
        // from older ai_service builds.
        @JsonProperty("error_code")
        private String errorCode;
    }
}
