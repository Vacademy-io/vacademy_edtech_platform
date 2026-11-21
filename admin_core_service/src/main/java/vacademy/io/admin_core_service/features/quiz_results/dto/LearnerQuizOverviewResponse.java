package vacademy.io.admin_core_service.features.quiz_results.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Quiz Results → Learner-wise, list view: one row per enrolled learner summarising how
 * they are doing across every quiz in the course.
 *
 * <p>This is the same graded data as the quiz-wise overview, pivoted the other way. A
 * teacher asking "who is falling behind" needs the learner as the row; asking "which quiz
 * is landing badly" needs the quiz as the row. Both come from one grading pass.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LearnerQuizOverviewResponse {

    private Summary summary;
    private List<LearnerRow> learners;

    /** rows returned; equals the enrolled count unless {@code truncated}. */
    private int returned;
    private boolean truncated;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Summary {
        private long enrolledLearners;
        private int quizzesInCourse;

        /** learners with at least one attempt at any quiz. */
        private long learnersAttempted;

        /** learners who have not attempted a single quiz. */
        private long learnersNotStarted;

        /** mean of the per-learner averages, over learners who attempted something. */
        private Double avgScorePercent;
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

        private int quizzesInCourse;
        private int quizzesAttempted;

        /** every attempt across every quiz, re-attempts included. */
        private long totalAttempts;

        /** marks earned across the quizzes they attempted (latest attempt of each). */
        private Double marksObtained;

        /** marks available in just those attempted quizzes — the denominator of the average. */
        private Double attemptedMaxMarks;

        /** marks available across ALL quizzes in the course, for "how much is left". */
        private Double courseMaxMarks;

        /** marksObtained / attemptedMaxMarks, as a %. Null until they attempt something. */
        private Double avgScorePercent;

        private Double bestScorePercent;
        private Double lowestScorePercent;

        private long correctCount;
        private long wrongCount;
        private long skippedCount;
        private long ungradedCount;

        /** quizzes passed, counting only quizzes that define a pass mark. */
        private long passedQuizzes;
        private long quizzesWithPassMark;

        private Long lastAttemptAtEpochMillis;
    }
}
