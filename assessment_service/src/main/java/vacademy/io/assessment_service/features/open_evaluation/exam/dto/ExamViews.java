package vacademy.io.assessment_service.features.open_evaluation.exam.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Response bodies of the exam, question and rubric endpoints (spec 7.1, 7.2, 7.4).
 * Null fields are left out, so one view serves the compact create response and the
 * fuller GET responses. Strings are handed back as the partner sent them (unescaped).
 */
public final class ExamViews {

    private ExamViews() {
    }

    /** {@code warnings[]} entry (spec 7.0). */
    public record Warning(@JsonProperty("code") String code,
                          @JsonProperty("message") String message,
                          @JsonProperty("field") String field) {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Exam {
        private String id;
        private String status;
        private String mode;
        private String title;
        private String externalRef;
        private String conductedOn;
        private String subject;
        private String level;
        private String board;
        @JsonProperty("class")
        private String className;
        private String answerLanguage;
        private String feedbackLanguage;
        private String instructions;
        private Boolean blind;
        private Double totalMarks;
        private Double paperMax;
        private Integer questionCount;
        private String dashboardUrl;
        private List<Question> questions;
        private List<ChoiceGroup> choiceGroups;
        private List<Map<String, Object>> candidates;
        private RubricSummary rubric;
        /** POST /exams only (spec 7.1): the rate of the exam's unit; absent when the price is not known in time. */
        private Map<String, Object> quote;
        private Map<String, Object> stats;
        private List<Warning> warnings;
        private String openedAt;
        private String finalizedAt;
        private String createdAt;
        private String updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Question {
        private String id;
        private String label;
        private String parentLabel;
        private String section;
        private String type;
        private String text;
        private Double maxMarks;
        private Double negativeMarks;
        private List<Option> options;
        private List<String> correctOptions;
        private Object answer;
        private String modelAnswer;
        private Map<String, Object> rubric;
        private Integer wordLimit;
        private Boolean expectsDiagram;
        private Boolean assessLanguage;
        private Map<String, Object> tags;
        private String externalId;
        /** Rubric store version after a rubric write (PUT …/rubric). */
        private Integer rubricVersion;
        /** "pending" while a rubric / model-answer change waits for ai_service. */
        private String rubricSync;
        private List<Warning> warnings;
    }

    public record Option(@JsonProperty("label") String label,
                         @JsonProperty("option_id") String optionId,
                         @JsonInclude(JsonInclude.Include.NON_NULL) @JsonProperty("text") String text) {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ChoiceGroup {
        private String id;
        private String label;
        private List<String> questionLabels;
        private List<String> questionIds;
        private Integer attempt;
        private String policy;
    }

    /** {@code rubric} block of an exam. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RubricSummary {
        private Integer version;
        private Boolean locked;
        private Integer questionsWithRubric;
        private Integer questionsWithoutRubric;
        /**
         * "pending" while changes wait for ai_service; "failed" while a change ai_service
         * refused is on record (see {@link #syncError}); absent once synced.
         */
        private String sync;
        /** {@code {"status", "code", "question_ids", "at"}} of the refused change, when sync is "failed". */
        private Map<String, Object> syncError;
    }
}
