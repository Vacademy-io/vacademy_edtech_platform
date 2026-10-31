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
 * Responses of the dashboard's on-demand panels: one class's learners, the
 * at-risk learner list and the written-feedback wall. Loaded lazily, so the main
 * dashboard call stays one round trip.
 */
public final class LiveClassDashboardDetails {

    private LiveClassDashboardDetails() {
    }

    /** One answer to a written feedback question. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class FeedbackAnswer {
        private String questionId;
        private String label;
        private String text;
    }

    // ─── Class drill-down ───────────────────────────────────────────────────

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ClassLearnersResponse {
        private String scheduleId;
        private List<ClassLearner> learners;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ClassLearner {
        /** user id for learners, registration / guest id otherwise. */
        private String id;
        /** USER | EXTERNAL_USER | GUEST */
        private String sourceType;
        private String name;
        private String email;
        private String mobile;
        private String packageSessionId;
        /** Expected in this class (enrolled in one of its batches, or added by hand). */
        private boolean expected;
        /** PRESENT | BELOW_RULE (joined, but short of the attendance rule) | NOT_JOINED */
        private String status;
        private String joinedAt;
        private Integer secondsInClass;
        private Integer talks;
        private Integer chats;
        private Integer raiseHands;
        private Integer pollVotes;
        private Integer emojis;
        /**
         * Opt-in camera activeness score (vacademy-activeness BBB plugin), 0-100; null
         * when the class did not enable it or no report arrived. on_screen / attention
         * are its components; seconds = time measured; away_count = times the learner
         * left the frame.
         */
        private Integer activeness;
        private Integer activenessOnScreen;
        private Integer activenessAttention;
        private Integer activenessSeconds;
        private Integer activenessAwayCount;
        /**
         * Why there is no (current) score: 1 measuring, 2 turned off by the learner,
         * 3 phone/tablet, 4 camera blocked, 5 no camera, 6 camera busy, 7 device too
         * slow, 8 could not load, 9 camera stopped, 10 waiting for camera permission.
         */
        private Integer activenessState;
        private Double rating;
        private List<FeedbackAnswer> answers;
    }

    // ─── At-risk learners ───────────────────────────────────────────────────

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AtRiskResponse {
        private int minMissed;
        /** ALL | DROPPED | NEVER — which slice {@code total} and {@code learners} are. */
        private String view;
        private int completedClasses;
        /** Learners matching, before the list limit. */
        private long total;
        private int limit;
        private List<AtRiskLearner> learners;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AtRiskLearner {
        private String userId;
        private String name;
        private String email;
        private String mobile;
        private String packageSessionId;
        private int expected;
        private int attended;
        private int missed;
        private Double attendanceRate;
        /** Finished classes missed in a row, counting back from the latest. */
        private int missStreak;
        private LocalDate lastAttended;
    }

    // ─── Feedback wall ──────────────────────────────────────────────────────

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class FeedbackWallResponse {
        private int limit;
        private List<FeedbackComment> comments;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class FeedbackComment {
        private String userId;
        private String learnerName;
        private String sessionId;
        private String scheduleId;
        private String title;
        private String subject;
        private LocalDate meetingDate;
        private String startTime;
        private List<LiveClassDashboardResponse.InstructorRef> instructors;
        private Double rating;
        private List<FeedbackAnswer> answers;
        private String submittedAt;
    }
}
