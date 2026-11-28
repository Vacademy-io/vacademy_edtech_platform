package vacademy.io.assessment_service.features.open_evaluation.exam.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Request bodies of the exam, question, rubric and choice-group endpoints
 * (docs/AI_EVALUATION_PUBLIC_API.md sections 7.1, 7.2, 7.4). snake_case on the wire.
 * Every string is plain text from the partner; the service escapes it where it lands in a
 * field the dashboard renders as rich text (spec 7.0, gate G15).
 */
public final class ExamInputs {

    private ExamInputs() {
    }

    /** {@code POST /exams}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CreateExam {
        private String title;
        private String mode;
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
        private Boolean open;
        private List<SectionInput> sections;
        private List<QuestionInput> questions;
        private List<ChoiceGroupInput> choiceGroups;
        private List<CandidateInput> candidates;
    }

    /** {@code sections[]}. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SectionInput {
        private String name;
        private Integer order;
    }

    /** Question object (spec 7.2). */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class QuestionInput {
        private String label;
        private String parentLabel;
        private String section;
        private String type;
        private String text;
        private BigDecimal maxMarks;
        private BigDecimal negativeMarks;
        private List<OptionInput> options;
        private List<String> correctOptions;
        /** numeric: a number (or numeric string); one_word: a string. */
        private JsonNode answer;
        private String modelAnswer;
        private RubricInput rubric;
        private Integer wordLimit;
        private Boolean expectsDiagram;
        private Boolean assessLanguage;
        private Map<String, Object> tags;
        private String externalId;
    }

    /** {@code options[]}. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class OptionInput {
        private String label;
        private String text;
    }

    /** Rubric object (spec 7.4), mapped 1:1 onto the engine's CriteriaRubric. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class RubricInput {
        private Boolean partialMarking;
        private String instructions;
        private List<CriterionInput> criteria = new ArrayList<>();
    }

    /** {@code rubric.criteria[]}. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CriterionInput {
        private String name;
        private BigDecimal marks;
        private List<String> keywords;
        private String guidance;
    }

    /** {@code choice_groups[]} (spec 7.2). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ChoiceGroupInput {
        private String label;
        private List<String> questionLabels;
        private Integer attempt;
        private String policy;
    }

    /** Candidate object (spec 7.3). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CandidateInput {
        private String externalId;
        private String name;
        private String rollNumber;
        private String sectionOrClass;
        private JsonNode metadata;
    }

    /** {@code POST /exams/{id}/questions}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class AddQuestions {
        private List<QuestionInput> questions;
    }

    /** {@code PUT /exams/{id}/choice-groups}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ReplaceChoiceGroups {
        private List<ChoiceGroupInput> choiceGroups;
    }

    /** {@code POST /exams/search}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SearchExams {
        private List<String> externalRefs;
    }
}
