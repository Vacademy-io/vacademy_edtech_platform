package vacademy.io.assessment_service.features.open_evaluation.submission.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;

import java.math.BigDecimal;
import java.util.List;

/**
 * Request bodies of the upload, submission, review, finalize and credit endpoints
 * (docs/AI_EVALUATION_PUBLIC_API.md 7.5, 7.6, 7.9, 7.10, 7.11). snake_case on the wire.
 * Every string is plain text from the partner.
 */
public final class SubmissionInputs {

    private SubmissionInputs() {
    }

    /** {@code POST /uploads}: one file at the top level, or up to 100 in {@code files[]}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CreateUploads {
        private List<UploadFile> files;
        private String filename;
        private String contentType;
        private Long sizeBytes;
        private String sha256;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class UploadFile {
        private String filename;
        private String contentType;
        private Long sizeBytes;
        private String sha256;
    }

    /** {@code POST /exams/{id}/submissions}: handwritten ({@code upload_id}) or typed ({@code answers}). */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CreateSubmission {
        private ExamInputs.CandidateInput candidate;
        private String candidateId;
        private String uploadId;
        private Boolean replace;
        private JsonNode metadata;
        /** Phase 2 (photos stitched to a PDF); refused in v1. */
        private List<String> images;
        /** Phase 3 (main booklet + supplements); refused in v1. */
        private List<String> files;
        private List<AnswerInput> answers;
    }

    /** One typed answer: by {@code question_id} or {@code question_label}. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class AnswerInput {
        private String questionId;
        private String questionLabel;
        /** long_answer. */
        private String text;
        /** mcq_single, mcq_multi, true_false. */
        private List<String> optionLabels;
        /** numeric (number) or one_word (string). */
        private JsonNode value;
    }

    /** {@code POST /submissions/{id}/re-evaluate}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Reevaluate {
        private List<String> questionIds;
        private Boolean keepReviewed;
    }

    /** {@code reviewer} on review calls: the partner's own teacher reference, plain text. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Reviewer {
        private String ref;
        private String name;
    }

    /** {@code PATCH /submissions/{id}/questions/{question_id}}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ReviewQuestion {
        private BigDecimal awarded;
        private String feedback;
        private Reviewer reviewer;
        private String reason;
    }

    /** {@code POST /submissions/{id}/approve}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Approve {
        private Reviewer reviewer;
    }

    /** {@code POST /exams/{id}/finalize}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Finalize {
        private List<String> submissionIds;
        private Boolean allGraded;
        private Boolean allowPartial;
    }

    /** {@code POST /submissions/{id}/unfinalize}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Unfinalize {
        private String reason;
    }

    /** {@code POST /credits/quote}: exactly one of the three. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Quote {
        private Long pages;
        private List<String> uploadIds;
        private Long typedAnswers;
    }
}
