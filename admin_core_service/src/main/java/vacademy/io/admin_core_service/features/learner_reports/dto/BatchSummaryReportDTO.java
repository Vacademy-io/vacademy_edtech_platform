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
 * Basic batch report for one batch, or every batch of the institute, over a date window:
 * assessment scores (average, score bands, per assessment, per subject, per learner), topic
 * strengths and weaknesses rolled up from analysed attempts, and for a single batch its course
 * completion, time, concentration, subject progress and most active learners.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BatchSummaryReportDTO {

    /** Null for the all-batches report. */
    private String packageSessionId;
    private String batchName;
    private String instituteName;
    /** Institute theme colour (hex) for the report header and charts; null for the default. */
    private String brandColor;
    private LocalDate startDate;
    private LocalDate endDate;
    private List<String> sections;

    private long enrolledLearners;
    /** Learners with at least one assessment attempt in the window. */
    private long learnersAssessed;
    private int assessmentsHeld;
    private long totalAttempts;
    /** Mean of the learners average assessment score. Null when nobody was assessed. */
    private Double avgScore;
    /** learnersAssessed / enrolledLearners, as a %. */
    private Double participationRate;
    /** The roster was capped; only the first learners are counted. */
    private boolean learnersTruncated;

    /** Learners by average score: 60% and above, 40 to 60%, under 40%, and not assessed. */
    private long strongLearners;
    private long averageLearners;
    private long weakLearners;
    private long notAssessedLearners;

    private List<AssessmentRow> assessments;
    private List<SubjectScoreRow> subjectScores;
    private List<TopicRow> topics;
    /** Analysed attempts the topic roll-up was built from. */
    private Integer attemptsAnalyzed;
    private List<LearnerRow> learners;
    /** All-batches report only: average score per batch. */
    private List<BatchRow> batches;

    // Single batch only.
    private Double avgCourseCompletion;
    private Double avgTimeSpentMinutes;
    private Double avgConcentration;
    private List<SubjectRow> subjects;
    private List<ActivityRow> activity;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AssessmentRow {
        private String assessmentId;
        private String name;
        /** First attempt date in the window (yyyy-MM-dd). */
        private String date;
        private String subject;
        private int attempts;
        private Double avgScore;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SubjectScoreRow {
        private String subject;
        private Double avgScore;
        private int assessments;
        private int attempts;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TopicRow {
        private String topic;
        private int questions;
        private int correct;
        private Double accuracy;
        private String masteryLevel;
    }

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
        private Double avgScore;
        private int assessmentsTaken;
        /** STRONG, AVERAGE, WEAK or NOT_ASSESSED. */
        private String band;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BatchRow {
        private String packageSessionId;
        private long learners;
        private long learnersAssessed;
        private Double avgScore;
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
