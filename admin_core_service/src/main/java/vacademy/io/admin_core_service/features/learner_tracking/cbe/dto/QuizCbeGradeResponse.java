package vacademy.io.admin_core_service.features.learner_tracking.cbe.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * The Spreadsheet &amp; Written Response questions of one quiz attempt and where each one's AI
 * check stands. Reply of both {@code grade} and {@code results}.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuizCbeGradeResponse {
    private String slideId;
    private String attemptId;
    /** Whether the quiz review may show model solutions to this learner now. */
    private boolean showSolutions;
    private List<Question> questions = new ArrayList<>();

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Question {
        private String questionId;
        /** PENDING | EVALUATING | EVALUATED | FAILED | SKIPPED | UNATTEMPTED | NO_CHECKS_LEFT */
        private String state;
        /** The row's response_status: CORRECT | WRONG | SUBMITTED | SKIPPED. */
        private String responseStatus;
        private Double marks;
        private Double maxMarks;
        /** marks_awarded, max_marks, verdict, feedback, criteria_breakdown[]; null until graded. */
        private JsonNode evaluation;
        /** {@code {"parts":[{"id","solution","markingScheme"}]}}: graded and solutions allowed only. */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private JsonNode solution;
        /** The learner's own answer as recorded (results only). */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private JsonNode answer;
        /** NO_CREDITS | EVALUATION_FAILED when the answer is saved but not graded. */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String errorCode;
        /** Why there is no evaluation, for the learner. */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String message;
        private int checksUsed;
        private int maxChecks;
    }
}
