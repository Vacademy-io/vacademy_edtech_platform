package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Time;
import java.util.Date;
import java.util.List;

@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
public class LiveSessionListDTO {
    private String sessionId;
    private Integer waitingRoomTime;
    private String thumbnailFileId;
    private String backgroundScoreFileId;
    private String sessionStreamingServiceType;
    private String scheduleId;
    // meeting_date is a DATE column read as java.sql.Date (midnight in the JVM zone, which is
    // forced to IST). Serialize in Asia/Kolkata so the calendar date is preserved — formatting
    // the IST-midnight instant in UTC would print the previous day (off-by-one).
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd", timezone = "Asia/Kolkata")
    private Date meetingDate;
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "HH:mm:ss", timezone = "UTC")
    private Time startTime;
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "HH:mm:ss", timezone = "UTC")
    private Time lastEntryTime;
    private String recurrenceType;
    private String accessLevel;
    private String title;
    private String subject;
    private String meetingLink;
    private String registrationFormLinkForPublicSessions;
    private String timezone;
    // Single object or list of objects — see LiveSessionStep1RequestDTO#learnerButtonConfig.
    private Object learnerButtonConfig;
    private String defaultClassLink;
    private String defaultClassName;
    private String linkType;
    private String providerMeetingId;
    // DEFAULT | PRE_JOINING — drives the learner waiting-room-window join button.
    private String waitingRoomType;
    private List<PackageSessionInfo> packageSessionDetails;
    /**
     * Instructors / presenters of the class (V524), for the learner card.
     *
     * <p>Populated only on the learner-facing lists, and omitted entirely when
     * null thanks to the class-level {@code NON_NULL} include — so the admin
     * lists' payloads are byte-for-byte what they were before this field
     * existed.
     */
    private List<LiveSessionInstructorDTO> instructors;

    public LiveSessionListDTO(String sessionId, Integer waitingRoomTime, String thumbnailFileId,
            String backgroundScoreFileId, String sessionStreamingServiceType, String scheduleId,
            Date meetingDate, Time startTime, Time lastEntryTime, String recurrenceType,
            String accessLevel, String title, String subject, String meetingLink,
            String registrationFormLinkForPublicSessions, String timezone,
            Object learnerButtonConfig,
            String defaultClassLink, String defaultClassName, String linkType) {
        this.sessionId = sessionId;
        this.waitingRoomTime = waitingRoomTime;
        this.thumbnailFileId = thumbnailFileId;
        this.backgroundScoreFileId = backgroundScoreFileId;
        this.sessionStreamingServiceType = sessionStreamingServiceType;
        this.scheduleId = scheduleId;
        this.meetingDate = meetingDate;
        this.startTime = startTime;
        this.lastEntryTime = lastEntryTime;
        this.recurrenceType = recurrenceType;
        this.accessLevel = accessLevel;
        this.title = title;
        this.subject = subject;
        this.meetingLink = meetingLink;
        this.registrationFormLinkForPublicSessions = registrationFormLinkForPublicSessions;
        this.timezone = timezone;
        this.learnerButtonConfig = learnerButtonConfig;
        this.defaultClassLink = defaultClassLink;
        this.defaultClassName = defaultClassName;
        this.linkType = linkType;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class PackageSessionInfo {
        private String packageSessionId;
        private String packageName;
        private String levelName;
        private String sessionName;
    }
}
