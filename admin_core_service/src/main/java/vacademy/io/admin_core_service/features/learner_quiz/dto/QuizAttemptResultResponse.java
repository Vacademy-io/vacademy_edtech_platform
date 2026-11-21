package vacademy.io.admin_core_service.features.learner_quiz.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.util.List;

/** Result of a submit, and the learner's standing on the quiz when read back later. */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuizAttemptResultResponse {

    public enum Status {
        /** This request graded and recorded the attempt. */
        GRADED,
        /** This attempt was already recorded; the stored result is returned unchanged. */
        ALREADY_GRADED,
        /** No attempt is left. Nothing was recorded; the answers sent were not graded. */
        ATTEMPTS_EXHAUSTED,
        /** A read: the attempts below, or none yet. */
        RESULT
    }

    private Status status;
    /** The attempt this response is about: the one submitted, or the latest on a read. */
    private String attemptId;
    private int attemptsUsed;
    /** Null when the quiz does not cap attempts. */
    private Integer maxAttempts;
    private Integer attemptsLeft;
    private boolean canAttempt;
    private Double passPercentage;
    /** Whether correct answers and explanations are included in {@link #answerKeys}. */
    private boolean showAnswers;
    /** Newest first. */
    private List<AttemptSummary> attempts;
    /** Empty unless {@link #showAnswers}. */
    private List<AnswerKey> answerKeys;

    @Data
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AttemptSummary {
        private String attemptId;
        private Long submittedAtMillis;
        private double earned;
        private double totalMarks;
        private int correct;
        private int partial;
        private int wrong;
        private int skipped;
        /** Answered, but not something this server can mark, such as a long answer. */
        private int pending;
        /** Null when the quiz has no pass mark, or a fail is not final while answers are pending. */
        private Boolean passed;
        private List<QuestionResult> questions;
    }

    @Data
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class QuestionResult {
        private String questionId;
        /** CORRECT, PARTIAL, WRONG, SKIPPED or PENDING. */
        private String outcome;
        private double marks;
        private double maxMarks;
    }

    @Data
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AnswerKey {
        private String questionId;
        private List<String> correctOptionIds;
        /** The author's model answer, for free-text questions. */
        private String correctAnswerText;
        private String explanation;
    }
}
