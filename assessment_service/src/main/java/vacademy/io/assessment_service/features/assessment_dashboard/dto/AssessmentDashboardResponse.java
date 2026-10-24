package vacademy.io.assessment_service.features.assessment_dashboard.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * The whole Assessment Dashboard in one payload.
 *
 * <p>Rates and scores are fractions (0..1) and are null when there was nothing to divide
 * by, so an empty denominator never reads as 0%. Instants are ISO-8601 UTC strings; dates
 * are yyyy-MM-dd in the requested timezone.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssessmentDashboardResponse {

    private String startDate;
    private String endDate;
    private String timezone;
    private String generatedAt;

    private Summary summary;

    /** Same filters over the equally long period just before; absent past 92 days. */
    private Summary previousSummary;
    private String previousStartDate;
    private String previousEndDate;

    private List<DailyPoint> daily;
    /** Ten buckets of 10 percentage points; bucket 0 also holds negative scores. */
    private List<ScoreBucket> scoreDistribution;
    private List<HeatCell> submissionHeatmap;
    private List<TypeSlice> types;
    private List<BatchStats> batches;
    /** Teachers who checked copies of the range's tests, most copies first. */
    private List<EvaluatorStats> evaluators;

    /** Assessments in the range, newest first, capped at {@code assessmentsLimit}. */
    private List<AssessmentRow> assessments;
    private int assessmentsLimit;
    private boolean assessmentsTruncated;

    /** Scheduled assessments whose window is open right now, whatever the range. */
    private List<AssessmentRow> liveNow;

    /** Learners who were set closed tests in the range and skipped at least one. */
    private List<LearnerStats> missedLearners;
    /** How many learners skipped at least N tests, keyed by N (1, 2, 3, 5). */
    private Map<Integer, Integer> missedCounts;
    private List<LearnerStats> topLearners;
    /** Learners averaging under {@code lowScoreBelow}, lowest first. */
    private List<LearnerStats> lowScorers;
    private int lowScorersTotal;
    private double lowScoreBelow;
    private int learnersLimit;

    /** Play modes present in the range before the play-mode filter, for the filter options. */
    private List<String> modeOptions;

    /**
     * False when batch membership could not be loaded from admin_core. The audience then
     * falls back to registered learners only, so "not attempted" is understated.
     */
    private boolean enrollmentAvailable;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Summary {
        private int totalAssessments;
        private int liveAssessments;
        private int upcomingAssessments;
        private int closedAssessments;
        /** Anytime tests (no closing date) with activity or created in the range. */
        private int openAssessments;

        /** Participation counts closed scheduled tests only. */
        private int expectedLearners;
        private int attemptedLearners;
        private int notAttempted;
        private Double participationRate;

        private int submissions;
        private int uniqueLearners;
        private int inProgress;

        private int scored;
        private Double avgScore;
        private Double highestScore;

        private int evaluated;
        private int awaitingEvaluation;
        private int awaitingRelease;
        /** How the evaluated submissions were checked; the four add up to {@code evaluated}. */
        private int checkedByTeacher;
        private int checkedByAi;
        private int autoGraded;
        /** Evaluated with no checking-tool record, e.g. marks entered offline. */
        private int evaluatedOther;

        private Double avgTimeMinutes;
        /** Average share of the allowed duration a learner used (timed tests only). */
        private Double avgTimeShare;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DailyPoint {
        private String date;
        /** Tests whose window opens that day. */
        private int assessments;
        private int submissions;
        private int learners;
        private Double avgScore;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ScoreBucket {
        /** Lower bound in percent: 0, 10, ... 90. */
        private int from;
        private int count;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class HeatCell {
        /** 0 = Monday. */
        private int weekday;
        private int hour;
        private int submissions;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TypeSlice {
        private String playMode;
        private int assessments;
        private int submissions;
        private Double avgScore;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BatchStats {
        private String packageSessionId;
        private int assessments;
        /** Over closed scheduled tests, like the summary. */
        private int expected;
        private int attempted;
        private Double participationRate;
        private int submissions;
        private Double avgScore;
        /** Submissions by this batch's learners that are evaluated / still waiting. */
        private int evaluated;
        private int awaitingEvaluation;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AssessmentRow {
        private String assessmentId;
        private String name;
        private String playMode;
        private String visibility;
        private String evaluationType;
        /** LIVE | UPCOMING | CLOSED | OPEN (anytime test, no closing date). */
        private String status;
        private String startTime;
        /** Null for anytime tests. */
        private String endTime;
        private Integer durationMinutes;
        private String subjectId;
        private List<String> batchIds;
        private Double maxMarks;

        private int expected;
        private int attempted;
        private int inProgress;
        private int notAttempted;
        private Double participationRate;

        private int submissions;
        private int scored;
        private Double avgScore;
        private Double highestScore;
        private Double lowestScore;
        private Double avgTimeMinutes;

        private int evaluated;
        private int awaitingEvaluation;
        private int awaitingRelease;
        private int checkedByTeacher;
        private int checkedByAi;
        /** Teachers who checked this test's copies (user ids; names are in {@code evaluators}). */
        private List<String> evaluatorIds;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class EvaluatorStats {
        private String userId;
        private String name;
        private String email;
        private int copiesChecked;
        private int tests;
        private Double avgMinutesPerCopy;
        private String lastCheckedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LearnerStats {
        private String userId;
        private String name;
        private String email;
        private String mobile;
        private String packageSessionId;
        /** Closed tests this learner was set, and how many of them they sat. */
        private int expectedTests;
        private int attemptedTests;
        private int missedTests;
        private Double attemptRate;
        private int scoredTests;
        private Double avgScore;
        private Double bestScore;
        private String lastSubmittedAt;
    }
}
