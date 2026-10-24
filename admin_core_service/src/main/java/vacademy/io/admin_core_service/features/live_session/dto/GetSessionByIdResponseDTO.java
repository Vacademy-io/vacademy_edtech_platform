package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class GetSessionByIdResponseDTO {
    private String sessionId;
    private String instituteId;
    private String title;
    private String subject;
    private String descriptionHtml;
    private String defaultMeetLink;
    private String defaultClassLink;
    private String defaultClassName;
    private String defaultClassLinkType;
    // Single object or list of objects — see LiveSessionStep1RequestDTO#learnerButtonConfig.
    private Object learnerButtonConfig;
    private LocalDateTime startTime;
    private LocalDateTime lastEntryTime;
    private String linkType;
    private String joinLink;
    private String recurrenceType;
    private LocalDate sessionEndDate;
    private String accessType;
    private String waitingRoomTime;
    private String waitingRoomType;
    private String thumbnailFileId;
    private String backgroundScoreFileId;
    private String coverFileId;
    private Boolean allowRewind;
    private Boolean allowPlayPause;
    // Attendance-only institutes: true when this class is shown to learners.
    private Boolean showToLearners;
    private String sessionStreamingServiceType;
    private String timezone;
    private Map<String, Object> bbbConfig;
    private Object feedbackConfig;
    private RecordingAutoLinkConfigDTO recordingAutoLinkConfig;
    private List<String> packageSessionIds;
    private List<PackageSessionDetail> packageSessionDetails;
    private List<ScheduleItem> addedSchedules;

    @Getter
    @Setter
    public static class ScheduleItem {
        private String Id;
        private String day;
        private String startTime;
        private String duration;
        private String link;
        private String defaultClassLink;
        private String defaultClassName;
        private Object learnerButtonConfig;
        private LocalDate meetingDate;
        private String timezone;
        private Boolean dailyAttendance;
        private String providerRecordingsJson;
        /** Per-schedule link_type — needed so the UI can branch (e.g. show "Start as Host" for Zoom). */
        private String linkType;
        /** Provider host-start URL (Zoom start_url with ZAK). Admin opens this to start as host with no prompts. */
        private String providerHostUrl;
    }

    @Getter
    @Setter
    public static class NotificationAction {
        private String id;
        private String type;
        private NotifyBy notifyBy;
        private boolean notify;
        private LocalDateTime time;
    }

    @Getter
    @Setter
    public static class NotifyBy {
        private boolean mail;
        private boolean whatsapp;
    }

    @Getter
    @Setter
    public static class Field {
        private String id;
        private String type;
        private String label;
        private Boolean required;
        private Boolean isDefault;
        /** Position in the registration form, so the builder can list fields in the saved order. */
        private Integer formOrder;
        /** Raw options JSON — without it the builder cannot show or keep a dropdown's choices. */
        private String config;
    }

    @Getter
    @Setter
    static public class NotificationConfigResponse {
        private List<NotificationAction> addedNotificationActions;
        private List<Field> addedFields = new ArrayList<>();
    }

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class PackageSessionDetail {
        private String packageSessionId;
        private String packageName;
        private String levelName;
        private String sessionName;
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
