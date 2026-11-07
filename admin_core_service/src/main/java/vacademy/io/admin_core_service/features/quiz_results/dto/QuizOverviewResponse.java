package vacademy.io.admin_core_service.features.quiz_results.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Quiz Results tab, list view: every quiz in the batch with the numbers a teacher scans
 * for - who attempted, how they scored, and which quiz is dragging the batch down.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QuizOverviewResponse {

    private Summary summary;
    private List<QuizRow> quizzes;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Summary {
        /** quizzes that exist in this batch (draft ones included). */
        private int totalQuizzes;

        /** learners enrolled in the batch (ACTIVE + INACTIVE), the participation denominator. */
        private long enrolledLearners;

        /** distinct learners who have attempted at least one quiz in this course. */
        private long learnersAttempted;

        /**
         * Attempted (learner, quiz) pairs — the numerator behind participation. Kept
         * separate from {@code learnersAttempted}: one learner who did all 114 quizzes
         * and 114 learners who did one each are the same number here and very different
         * classes, so the UI reports both.
         */
        private long attemptedPairs;

        /** mean score % across every learner-quiz pair that was attempted; null when none were. */
        private Double avgScorePercent;

        /** attempted learner-quiz pairs / (quizzes x enrolled), as a %. */
        private Double participationPercent;

        /** quizzes nobody in the batch has attempted yet. */
        private int quizzesWithNoAttempts;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QuizRow {
        private String slideId;
        private String quizSlideId;
        private String title;
        private String slideStatus;
        private String subjectName;
        private String moduleName;
        private String chapterId;
        private String chapterName;

        private long questionCount;
        private double totalMarks;
        private Double passPercentage;
        private Integer timeLimitInMinutes;

        private long attemptedLearners;
        private long enrolledLearners;
        private long totalAttempts;

        /** mean score % over latest attempts; null when nobody has attempted. */
        private Double avgScorePercent;

        /** correct / (correct + wrong + skipped) as a %; null when nothing was answered. */
        private Double accuracyPercent;

        private long correctResponses;
        private long wrongResponses;
        private long skippedResponses;

        /**
         * Responses no answer key could grade (free text, manual evaluation, a key shape
         * the scorer does not recognise). Surfaced rather than folded into "wrong" so the
         * accuracy figure stays honest about what it actually measured.
         */
        private long ungradedResponses;

        /** null unless the quiz defines a pass percentage. */
        private Long passedLearners;

        private Long avgTimeSeconds;
        private Long lastAttemptAtEpochMillis;
    }
}
