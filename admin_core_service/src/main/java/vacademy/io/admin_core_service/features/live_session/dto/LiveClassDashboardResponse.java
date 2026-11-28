package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/**
 * Everything the admin Live Class Dashboard renders, in one response.
 *
 * <p>Rates are fractions (0..1) and are {@code null} when there is nothing to
 * divide by, so the UI can show "—" instead of a misleading 0%. Attendance is
 * counted against the class audience (the learners of its batches plus any
 * individually-added learners), and only for classes that have already ended.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LiveClassDashboardResponse {

    private LocalDate startDate;
    private LocalDate endDate;
    private String generatedAt;

    private Summary summary;

    /**
     * The same filters over the equally long period just before the range, for
     * the ▲/▼ deltas. Absent for ranges longer than a quarter.
     */
    private Summary previousSummary;
    private LocalDate previousStartDate;
    private LocalDate previousEndDate;
    private List<RatingBucket> ratingDistribution;
    private List<DailyPoint> daily;
    private List<PlatformSlice> platforms;
    private List<InstructorStats> instructors;
    private List<BatchStats> batches;

    /** Classes in the range, newest first. Capped at {@code classesLimit}. */
    private List<ClassRow> classes;
    private Integer classesLimit;
    private Boolean classesTruncated;

    /** Classes in progress right now — independent of the date range. */
    private List<ClassRow> liveNow;

    /** Every instructor in the range before the instructor filter — feeds the filter. */
    private List<InstructorRef> instructorOptions;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Summary {
        private int totalClasses;
        private int completedClasses;
        private int liveClasses;
        private int upcomingClasses;

        /** Sums over completed classes. */
        private long expectedLearners;
        private long joined;
        private long present;
        /** Present / joined among the expected learners only — the attendance donut. */
        private long presentInAudience;
        private long joinedInAudience;
        private long guests;
        private Double attendanceRate;
        private Double avgJoinedPerClass;

        private Double avgScheduledMinutes;
        private Double avgAttendedMinutes;
        /** Average share of the scheduled duration an attendee stayed. */
        private Double avgStayRate;

        private Double engagementRate;
        private long engagementTracked;
        /** Attendees (of those tracked) who did each thing at least once. */
        private long spokeCount;
        private long chattedCount;
        private long raisedHandCount;
        private long votedCount;
        private long reactedCount;
        private long chats;
        private long talks;
        private long talkSeconds;
        private long raiseHands;
        private long emojis;
        private long pollVotes;

        private long feedbackCount;
        private long ratedCount;
        private Double avgRating;
        private Double feedbackRate;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RatingBucket {
        private int stars;
        private long count;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DailyPoint {
        private LocalDate date;
        private int classes;
        private int completed;
        private long expected;
        private long joined;
        private long present;
        /** Present among the expected learners — the numerator of attendanceRate. */
        private long presentInAudience;
        private Double attendanceRate;
        private long feedbackCount;
        private Double avgRating;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PlatformSlice {
        private String platform;
        private int classes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class InstructorRef {
        private String userId;
        private String name;
        private String email;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class InstructorStats {
        private String userId;
        private String name;
        private String email;
        private int classes;
        private int completed;
        private long expected;
        private long joined;
        private long present;
        private Double attendanceRate;
        private Double avgAttendedMinutes;
        private Double engagementRate;
        private long feedbackCount;
        private Double avgRating;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BatchStats {
        private String packageSessionId;
        private int classes;
        private long expected;
        private long joined;
        private long present;
        private Double attendanceRate;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ClassRow {
        private String scheduleId;
        private String sessionId;
        private String title;
        private String subject;
        private LocalDate meetingDate;
        private String startTime;
        private String endTime;
        private String timezone;
        private String platform;
        private String accessLevel;
        /** LIVE | UPCOMING | COMPLETED */
        private String status;
        private Integer scheduledMinutes;
        private List<InstructorRef> instructors;
        private List<String> batchIds;

        private long expected;
        private long joined;
        private long present;
        private long guests;
        private Double attendanceRate;
        private Double avgAttendedMinutes;

        private Double engagementRate;
        private long chats;
        private long talks;
        private long raiseHands;
        private long pollVotes;
        private long emojis;

        private long feedbackCount;
        private Double avgRating;
    }
}
