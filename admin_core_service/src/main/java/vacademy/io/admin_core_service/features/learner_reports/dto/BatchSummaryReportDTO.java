package vacademy.io.admin_core_service.features.learner_reports.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/**
 * Basic batch report: how many learners passed (average quiz score against the institute's
 * pass mark), course completion, time and concentration for the window, subject progress,
 * per-learner results and the most active learners.
 *
 * Quiz results cover every attempt to date — quiz grading has no date dimension — while the
 * completion, time, concentration and activity figures are for the selected window.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BatchSummaryReportDTO {

    private String packageSessionId;
    private String batchName;
    private String instituteName;
    /** Institute theme colour (hex) for the report header and charts; null for the default. */
    private String brandColor;
    private LocalDate startDate;
    private LocalDate endDate;

    private double passPercentage;
    private List<String> sections;

    private long enrolledLearners;
    private long learnersAttempted;
    private long passedLearners;
    private long failedLearners;
    private long notAttemptedLearners;
    /** passedLearners / enrolledLearners, as a %. Null when the batch has no learners. */
    private Double passRate;
    private Double avgQuizScore;
    private int quizzesInCourse;
    /** The learner list was capped by the quiz-results row limit. */
    private boolean learnersTruncated;

    private Double avgCourseCompletion;
    private Double avgTimeSpentMinutes;
    private Double avgConcentration;

    private List<SubjectRow> subjects;
    private List<LearnerRow> learners;
    private List<ActivityRow> activity;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SubjectRow {
        private String subjectName;
        private Double avgCompletion;
        private Double avgTimeMinutes;
        private int modules;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LearnerRow {
        private String userId;
        private String fullName;
        private Double avgScorePercent;
        private int quizzesAttempted;
        private int quizzesInCourse;
        /** PASSED, FAILED or NOT_ATTEMPTED. */
        private String status;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ActivityRow {
        private Integer rank;
        private String userId;
        private String fullName;
        private Double totalTimeMinutes;
        private Double dailyAvgMinutes;
        private Double avgConcentration;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SendResult {
        private String audience;
        private int sent;
        private int skipped;
        /** Why some recipients were skipped, e.g. "12 learners have no parent email". */
        private List<String> notes;
    }
}
