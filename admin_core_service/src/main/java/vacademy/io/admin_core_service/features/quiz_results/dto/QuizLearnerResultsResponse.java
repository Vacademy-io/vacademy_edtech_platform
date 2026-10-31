package vacademy.io.admin_core_service.features.quiz_results.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Quiz Results tab, learner view for one quiz: the quiz's own numbers plus a row per
 * enrolled learner (attempted or not).
 *
 * <p>The roster is returned whole rather than page by page. A batch is tens-to-hundreds of
 * learners, not an unbounded table, and handing the client the full set is what makes
 * sorting by score, filtering to "not attempted" and CSV export instant instead of a
 * round trip each. {@code truncated} says the server hit its own ceiling, so the UI can
 * be honest about it instead of quietly showing a partial class.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QuizLearnerResultsResponse {

    private QuizMeta quiz;
    private Distribution distribution;
    private List<LearnerRow> learners;

    /** rows returned; equals the enrolled count unless {@code truncated}. */
    private int returned;

    private boolean truncated;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QuizMeta {
        private String slideId;
        private String quizSlideId;
        private String title;
        private String slideStatus;
        private String subjectName;
        private String moduleName;
        private String chapterName;
        private long questionCount;
        private double totalMarks;
        private Double passPercentage;
        private Integer timeLimitInMinutes;
        private Integer reAttemptCount;

        private long enrolledLearners;
        private long attemptedLearners;
        private long totalAttempts;

        /** responses no answer key could grade - shown as a caveat, never as failures. */
        private long ungradedResponses;

        private Double avgScorePercent;
        private Double highestScorePercent;
        private Double lowestScorePercent;
        private Double medianScorePercent;
        private Long passedLearners;
        private Long avgTimeSeconds;
    }

    /**
     * Score spread in fixed 10% bands (0-9, 10-19, … 90-100), attempted learners only.
     * Fixed bands rather than data-driven ones so the chart is comparable between quizzes.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Distribution {
        private List<Bucket> buckets;

        @Data
        @Builder
        @NoArgsConstructor
        @AllArgsConstructor
        public static class Bucket {
            private int from;
            private int to;
            private long learners;
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class LearnerRow {
        private String userId;
        private String fullName;
        private String email;
        private String mobileNumber;
        private String enrollmentStatus;

        /** PASSED | FAILED | COMPLETED | PARTIAL | NOT_ATTEMPTED */
        private String status;

        private long attemptCount;
        private Long lastAttemptAtEpochMillis;
        private String latestActivityId;

        private Double marksObtained;
        private Double totalMarks;
        private Double scorePercent;

        private long correctCount;
        private long wrongCount;
        private long skippedCount;

        /** answered, but not auto-gradable - excluded from the score rather than marked wrong. */
        private long ungradedCount;

        /** active questions with no tracked response at all on the latest attempt. */
        private long unansweredCount;

        private Long timeSpentSeconds;
    }
}
