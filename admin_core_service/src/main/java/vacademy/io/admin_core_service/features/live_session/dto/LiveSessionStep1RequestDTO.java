package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.*;

import java.sql.Timestamp;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class LiveSessionStep1RequestDTO {
    private String sessionId;
    private String instituteId;
    private String title;
    private String subject;
    private String descriptionHtml;
    private String defaultMeetLink;
    private String defaultClassLink;
    private String defaultClassName;
    private String joinLink;
    private Timestamp startTime;
    private Timestamp lastEntryTime;
    private String sessionEndDate; // Note: fixed casing to `sessionEndDate`
    private String recurrenceType; // e.g., "WEEKLY"
    private String linkType;
    private Integer waitingRoomTime;
    // DEFAULT (waiting-room screen) | PRE_JOINING (join live class directly during
    // the waiting-room window). See WaitingRoomTypeEnum.
    private String waitingRoomType;
    private String thumbnailFileId;
    private String backgroundScoreFileId;
    private String coverFileId;
    private Boolean allowRewind;
    private String sessionStreamingServiceType;

    private boolean allowPlayPause; // new added
    private String timeZone;

    // Attendance-only institutes: true shows this class to learners. Null
    // leaves the stored value untouched (older clients, edits that omit it).
    private Boolean showToLearners;

    private String bookingTypeId;
    private String source;
    private String sourceId;

    private List<ScheduleDTO> addedSchedules;
    private List<ScheduleDTO> updatedSchedules;
    private List<String> deletedScheduleIds;

    // Either a single LearnerButtonConfigDTO-shaped object (legacy) or a list of
    // them. Kept untyped so both shapes round-trip untouched; see
    // LearnerButtonConfigDTO for the field names.
    private Object learnerButtonConfig;

    private BbbConfigDTO bbbConfig;

    private FeedbackConfigDTO feedbackConfig;

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class FeedbackConfigDTO {
        private Boolean enabled;
        // When false, learners cannot dismiss the feedback form and must answer
        // every enabled+mandatory question. Null/true preserves the previous
        // skip-allowed behavior so existing sessions are unaffected.
        private Boolean allowSkip;
        private java.util.List<FeedbackQuestionDTO> questions;
    }

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class FeedbackQuestionDTO {
        private String id;
        private String type;       // "star_rating" or "free_text"
        private String label;
        private Boolean enabled;
        private Boolean mandatory;
        private Integer maxStars;  // only for star_rating
        private Boolean allowHalf; // only for star_rating
    }

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class BbbConfigDTO {
        private Boolean record;
        private Boolean autoStartRecording;
        private Boolean muteOnStart;
        private Boolean webcamsOnlyForModerator;
        private String guestPolicy;
        // Lock settings — restrict viewers (students) only; moderators are unaffected.
        // disableMic forces viewers into listen-only mode, which is what makes
        // large broadcast-style classes viable; disableCam blocks viewer webcams.
        private Boolean disableMic;
        private Boolean disableCam;
        private Boolean disablePrivateChat;
        private Boolean disablePublicChat;
        private Boolean disableSharedNotes;
        private Boolean hideUserList;
        // Auto-end the meeting shortly after the last moderator leaves
        private Boolean endWhenNoModerator;
        // Opt-in on-device camera attention score (vacademy-activeness BBB plugin).
        // Viewers only; persisted as activeness_score. Must stay declared here —
        // this DTO is typed, so an undeclared key never reaches bbb_config_json.
        private Boolean activenessScore;
    }

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class ScheduleDTO {
        private String id; // required for update only
        private String day;
        private String startTime;
        private String duration;
        private String link;

        // new added field
        private String thumbnailFileId;
        private boolean dailyAttendance;
        private String defaultClassLink;
        private String defaultClassName;
        private Object learnerButtonConfig;
    }

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class LearnerButtonConfigDTO {
        private boolean isVisible;
        private String text;
        private String url;
        private String backgroundColor;
        private String textColor;
    }
}
