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

    /** Null for the all-batches report and for several batches. */
    private String packageSessionId;
    /** The batches of a several-batches report; empty otherwise. */
    private List<String> packageSessionIds;
    private String batchName;
    private String instituteName;
    /** Institute theme colour (hex) for the report header and charts; null for the default. */
    private String brandColor;
    /** Public URL of the institute logo; null when the institute has none. */
    private String logoUrl;
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
    /** Every assessment attempted in the window, before the assessment filter; for the picker. */
    private List<AssessmentOption> availableAssessments;
    /** The assessments the report is limited to; empty when it covers all of them. */
    private List<String> assessmentIds;
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

    /** How the report scope moved over the window. */
    private Timeline timeline;
    /** Points and badges earned in the window. */
    private Gamification gamification;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Timeline {
        /** DAY, WEEK or MONTH, by the length of the window. */
        private String granularity;
        private List<TimelinePeriod> periods;
        /** Assessments and classes in date order, newest last. */
        private List<TimelineEvent> events;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TimelinePeriod {
        /** First day of the period inside the window (yyyy-MM-dd). */
        private String start;
        /** Last day of the period inside the window (yyyy-MM-dd). */
        private String end;
        private long activeLearners;
        private Double totalMinutes;
        /** Per learner who studied in the period. */
        private Double avgMinutes;
        private long slidesOpened;
        private int assessments;
        private int attempts;
        /** Average of the attempts in the period; null when there were none. */
        private Double avgScore;
        private int classesHeld;
        /** Learners present over learners expected; null when no class was held. */
        private Double attendancePct;
        private long points;
        private long badges;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TimelineEvent {
        /** yyyy-MM-dd. */
        private String date;
        /** ASSESSMENT or LIVE_CLASS. */
        private String type;
        private String title;
        /** Average score of an assessment, or attendance of a class, as a %. */
        private Double value;
        private String detail;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Gamification {
        private long totalPoints;
        private long learnersEarning;
        private long badgesAwarded;
        private List<EarnerRow> topEarners;
        private List<BadgeRow> topBadges;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class EarnerRow {
        private String userId;
        private String fullName;
        private long points;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BadgeRow {
        private String name;
        private String icon;
        private long awards;
        private long learners;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DailyTimeRow {
        private String date;
        /** Average minutes per learner who studied that day. */
        private Double avgMinutes;
        private long activeLearners;
        private Double totalMinutes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AssessmentOption {
        private String assessmentId;
        private String name;
        private String date;
    }

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
        /** Learners with questions in this topic. */
        private Integer learners;
        /** Of those, learners under 40% in this topic. */
        private Integer learnersStruggling;
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
        /** Score in the most recent assessment of the window. */
        private Double latestScore;
        /** latestScore minus the average of the earlier assessments; null with fewer than two. */
        private Double scoreChange;
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
