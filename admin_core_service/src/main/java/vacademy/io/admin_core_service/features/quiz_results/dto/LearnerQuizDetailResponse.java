package vacademy.io.admin_core_service.features.quiz_results.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Quiz Results → Learner-wise, side view: everything one learner has done across the
 * course's quizzes, including the quizzes they have not touched.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LearnerQuizDetailResponse {

    private LearnerQuizOverviewResponse.LearnerRow learner;
    private List<QuizRow> quizzes;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QuizRow {
        private String slideId;
        private String title;
        private String subjectName;
        private String moduleName;
        private String chapterName;

        private long questionCount;
        private Double totalMarks;
        private Double passPercentage;

        /** PASSED | FAILED | COMPLETED | PARTIAL | NOT_ATTEMPTED */
        private String status;

        /** how many times they have taken it; 0 when never attempted. */
        private long attemptCount;

        /** the latest attempt's numbers — what the learner actually ends up graded on. */
        private Double marksObtained;
        private Double scorePercent;
        private long correctCount;
        private long wrongCount;
        private long skippedCount;
        private long ungradedCount;
        private long unansweredCount;

        private Long timeSpentSeconds;
        private Long lastAttemptAtEpochMillis;
    }
}
