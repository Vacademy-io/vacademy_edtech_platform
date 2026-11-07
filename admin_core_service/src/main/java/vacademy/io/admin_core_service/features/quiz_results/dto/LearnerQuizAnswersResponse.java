package vacademy.io.admin_core_service.features.quiz_results.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Quiz Results → Learner-wise, answer view: what one learner actually answered on one
 * quiz, attempt by attempt.
 *
 * <p>Attempts are numbered oldest-first (attempt 1 is their first try), which is how a
 * teacher refers to them. The latest attempt is the one the score everywhere else is
 * taken from, and is flagged as such so the two can never be confused.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LearnerQuizAnswersResponse {

    private String slideId;
    private String quizTitle;
    private String userId;
    private String fullName;
    private long questionCount;
    private Double totalMarks;
    private Double passPercentage;

    private List<Attempt> attempts;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Attempt {
        /** 1-based, oldest first. */
        private int attemptNumber;
        private String activityId;
        private Long attemptedAtEpochMillis;
        private Long timeSpentSeconds;

        /** true for the attempt every other screen reports. */
        private boolean latest;

        private Double marksObtained;
        private Double scorePercent;
        private long correctCount;
        private long wrongCount;
        private long skippedCount;
        private long ungradedCount;
        private long unansweredCount;

        private List<Answer> answers;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Answer {
        private String questionId;
        private int order;
        private String questionText;
        private String questionType;
        private String explanation;

        /** CORRECT | WRONG | SKIPPED | UNGRADED | NOT_ANSWERED */
        private String verdict;

        /** what the learner picked, rendered as text; empty when they skipped. */
        private String learnerAnswer;

        /** the answer key as text; empty when the question is not auto-gradable. */
        private String correctAnswer;

        private double marks;

        /** marks actually credited for this question on this attempt. */
        private double marksAwarded;

        private List<Option> options;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Option {
        private String optionId;
        private String text;
        private boolean correct;
        private boolean selected;
    }
}
