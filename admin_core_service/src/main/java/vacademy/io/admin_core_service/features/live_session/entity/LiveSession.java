package vacademy.io.admin_core_service.features.live_session.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.live_session.enums.WaitingRoomTypeEnum;

import java.sql.Timestamp;
import java.util.Date;

@Entity
@Table(name = "live_session")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@SqlResultSetMapping(name = "LiveSessionListProjectionMapping", classes = @ConstructorResult(targetClass = LiveSessionListProjectionImpl.class, columns = {
        @ColumnResult(name = "sessionId", type = String.class),
        @ColumnResult(name = "waitingRoomTime", type = Integer.class),
        @ColumnResult(name = "thumbnailFileId", type = String.class),
        @ColumnResult(name = "backgroundScoreFileId", type = String.class),
        @ColumnResult(name = "sessionStreamingServiceType", type = String.class),
        @ColumnResult(name = "scheduleId", type = String.class),
        @ColumnResult(name = "meetingDate", type = java.sql.Date.class),
        @ColumnResult(name = "startTime", type = java.sql.Time.class),
        @ColumnResult(name = "lastEntryTime", type = java.sql.Time.class),
        @ColumnResult(name = "recurrenceType", type = String.class),
        @ColumnResult(name = "accessLevel", type = String.class),
        @ColumnResult(name = "title", type = String.class),
        @ColumnResult(name = "subject", type = String.class),
        @ColumnResult(name = "registrationFormLinkForPublicSessions", type = String.class),
        @ColumnResult(name = "allowPlayPause", type = Boolean.class),
        @ColumnResult(name = "timezone", type = String.class),
        @ColumnResult(name = "meetingLink", type = String.class),
        @ColumnResult(name = "learnerButtonConfig", type = String.class),
        @ColumnResult(name = "defaultClassLink", type = String.class),
        @ColumnResult(name = "defaultClassName", type = String.class),
        @ColumnResult(name = "linkType", type = String.class),
        @ColumnResult(name = "providerMeetingId", type = String.class),
        @ColumnResult(name = "waitingRoomType", type = String.class)
}))
public class LiveSession {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    private String instituteId;

    private Timestamp startTime;
    private Timestamp lastEntryTime;

    private String accessLevel;
    private String meetingType;
    private String defaultMeetLink;
    private String linkType;
    private String waitingRoomLink;
    private String registrationFormLinkForPublicSessions;
    private String createdByUserId;

    private String title;
    private String descriptionHtml;
    private String notificationEmailMessage;
    private String attendanceEmailMessage;
    private String coverFileId;
    private String subject;
    private String status;

    private Integer waitingRoomTime; // New field
    /**
     * Waiting room type — see {@link vacademy.io.admin_core_service.features.live_session.enums.WaitingRoomTypeEnum}.
     * DEFAULT keeps the waiting-room screen; PRE_JOINING lets the learner join the
     * live class directly during the waiting-room window.
     */
    @Column(name = "waiting_room_type")
    private String waitingRoomType;
    private String thumbnailFileId; // New field
    private String backgroundScoreFileId; // New field

    @Column(name = "learner_button_config", columnDefinition = "text")
    private String learnerButtonConfig;

    private Boolean allowRewind;
    private String sessionStreamingServiceType;

    @Column(name = "booking_type_id")
    private String bookingTypeId;

    @Column(name = "source")
    private String source;

    @Column(name = "source_id")
    private String sourceId;

    /**
     * Public-registration contact verification (V399). When true, the public
     * form requires an email OTP / a WhatsApp OTP (institute must have an
     * approved WhatsApp OTP template) before registering. Both default false.
     */
    @Column(name = "require_email_verification")
    private Boolean requireEmailVerification;

    @Column(name = "require_phone_verification")
    private Boolean requirePhoneVerification;

    /**
     * WhatsApp template used for the phone-verification OTP (V403). NULL falls
     * back to the institute/platform default OTP template.
     */
    @Column(name = "whatsapp_otp_template_name")
    private String whatsappOtpTemplateName;

    /** JSON config for BBB meetings (record, muteOnStart, webcamsOnlyForModerator, guestPolicy) */
    @Column(name = "bbb_config_json", columnDefinition = "text")
    private String bbbConfigJson;

    /** JSON config for post-session learner feedback (enabled, questions with type/mandatory flags) */
    @Column(name = "feedback_config_json", columnDefinition = "text")
    private String feedbackConfigJson;

    /**
     * Provider-account id (Zoom or Google Meet, despite the column name) chosen for
     * this session, and the meeting settings
     * JSON the admin configured. Persisted so the provisioning retry job can
     * re-create meetings for any occurrence whose up-front async provisioning was
     * interrupted (process restart / partial failure) without re-asking the UI.
     */
    @Column(name = "zoom_account_id")
    private String zoomAccountId;

    @Column(name = "zoom_config_json", columnDefinition = "text")
    private String zoomConfigJson;

    /**
     * JSON config for auto-linking newly-synced recordings of this session into
     * course chapters (enabled, slideStatus, notify, destinations). See
     * docs/LIVE_SESSION_RECORDING_AUTO_LINK_PLAN.md and RecordingAutoLinkService.
     */
    @Column(name = "recording_auto_link_json", columnDefinition = "text")
    private String recordingAutoLinkJson;

    /**
     * JSON config for pushing public registrants into admin-selected audience
     * lists (enabled, audienceIds). See LiveSessionAudiencePushConfigDTO.
     */
    @Column(name = "audience_push_config_json", columnDefinition = "text")
    private String audiencePushConfigJson;

    /**
     * Minimum-attendance rule this class was scheduled under:
     * {enabled, minDurationPercent}. Copied from the institute's
     * LIVE_SESSION_SETTING.defaultAttendanceCriteria at creation, never read
     * from that setting later. NULL or disabled means the join click alone
     * decides attendance. See AttendanceCriteriaService.
     */
    @Column(name = "attendance_criteria_json", columnDefinition = "text")
    private String attendanceCriteriaJson;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;

    @Column(name = "allow_play_pause")
    private boolean allowPlayPause;

    /**
     * Only read while the institute has LIVE_SESSION_SETTING.attendanceOnlyMode
     * on: TRUE shows this class to learners, FALSE/NULL keeps it attendance
     * only. See LiveSessionAttendanceOnlyModeService.
     */
    @Column(name = "show_to_learners")
    private Boolean showToLearners;

    private String timezone;

    @PrePersist
    public void prePersist() {
        if (this.accessLevel == null) {
            this.accessLevel = "private";
        }
        if (this.waitingRoomType == null) {
            this.waitingRoomType = WaitingRoomTypeEnum.WAITING_ROOM.name();
        }
    }
}
