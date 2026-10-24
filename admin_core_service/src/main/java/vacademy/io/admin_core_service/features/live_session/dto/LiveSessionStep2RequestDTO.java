package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO;
import vacademy.io.admin_core_service.features.live_session.enums.NotificationTypeEnum;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class LiveSessionStep2RequestDTO {
    private String sessionId;
    private String accessType;

    private List<String> packageSessionIds;
    private List<String> deletedPackageSessionIds;
    
    // === Individual User Operations ===
    private List<String> individualUserIds;       //new added fields
    private List<String> deletedIndividualUserIds;

    private String joinLink;

    /**
     * The session's instructors / presenters (V524), as user ids.
     *
     * <p>Tri-state on purpose:
     * <ul>
     *   <li><b>null</b> — the client didn't touch instructors. Every client
     *       written before this feature sends null, and keeps its existing
     *       behaviour: the creator seeded at step 1 stays.</li>
     *   <li><b>empty list</b> — explicitly remove all instructors. The session
     *       then falls back to its creator, so it never becomes orphaned.</li>
     *   <li><b>non-empty</b> — the exact list to reconcile to.</li>
     * </ul>
     *
     * <p>Lives on step 2 alongside the other "who is this class for" fields,
     * which also gives the bulk endpoint instructor support for free via
     * {@code step2PerRow}.
     */
    private List<String> instructorUserIds;

    /**
     * Instructors as humans typed them — user id, email or username (V524).
     *
     * <p>Exists for the bulk CSV import, where an admin authoring a spreadsheet
     * cannot reasonably be asked for UUIDs. Resolved against the institute's
     * staff directory and merged into {@link #instructorUserIds}; identifiers
     * that match nobody are reported as a per-row warning rather than failing
     * the row, so one typo in one cell does not cost the admin the import.
     *
     * <p>Ignored when null. Resolution is additive: sending both this and
     * {@code instructorUserIds} yields the union.
     */
    private List<String> instructorIdentifiers;

    // === Reschedule Context ===
    /**
     * Wall-clock schedule this session held BEFORE the current edit, supplied by the
     * client so the ON_EDIT mail can render {{OLD_TIME}}.
     *
     * Step 1 and step 2 are separate requests: by the time step 2 sends the mail,
     * step 1 has already overwritten the stored schedule, so the previous value
     * cannot be recovered server-side. The client holds it (it snapshots the session
     * when the admin opens it for editing) and passes it back here.
     *
     * Formats: {@code oldMeetingDate} = "yyyy-MM-dd", {@code oldStartTime} = "HH:mm:ss".
     * Both null for a first publish, or from clients that don't send them.
     */
    private String oldMeetingDate;
    private String oldStartTime;

    // === Notification Setting Operations ===
    private List<NotificationActionDTO> addedNotificationActions;
    private List<NotificationActionDTO> updatedNotificationActions;
    private List<String> deletedNotificationActionIds;

    // === Custom Field Operations ===
    // Legacy add/update/delete tri-arrays. Kept for backward compatibility with
    // older clients; new clients should send `instituteCustomFields` instead.
    @Deprecated
    private List<CustomFieldDTO> addedFields;
    @Deprecated
    private List<CustomFieldDTO> updatedFields;
    @Deprecated
    private List<String> deletedFieldIds;

    /**
     * Unified custom-field picker payload (custom fields revamp).
     *
     * The frontend sends the FULL list of fields the admin selected for this
     * live session — institute defaults that were pre-selected (and not
     * un-checked) plus any ad-hoc fields the admin added in the dialog.
     * The backend reconciles by calling
     * {@code InstituteCustomFiledService.syncFeatureCustomFields(instituteId, "SESSION", sessionId, ...)}.
     *
     * When this field is non-null the legacy tri-arrays above are ignored.
     */
    private List<InstituteCustomFieldDTO> instituteCustomFields;

    /**
     * Paid live session config (one price for the whole session/series). Null =
     * request doesn't touch payment settings (older clients keep working);
     * enabled=false explicitly turns an existing paid session free again.
     */
    private LiveSessionPaymentConfigDTO paymentConfig;

    /**
     * Public-registration contact verification toggles. Null = request doesn't
     * touch them (older clients keep working); explicit true/false overwrites.
     * Phone verification is delivered over WhatsApp and needs the institute's
     * approved OTP template.
     */
    private Boolean requireEmailVerification;
    private Boolean requirePhoneVerification;

    /**
     * WhatsApp template for the phone-verification OTP. Null = don't touch
     * (older clients); empty string clears back to the institute default.
     */
    private String whatsappOtpTemplateName;

    /**
     * Optional "auto-add recordings to course" config. Omitting this field on
     * update leaves the stored config unchanged; sending {"enabled": false, ...}
     * disables auto-linking. See RecordingAutoLinkConfigDTO.
     */
    private RecordingAutoLinkConfigDTO recordingAutoLinkConfig;

    /**
     * Optional "save registrants to audience list(s)" config for public
     * sessions. Omitting this field on update leaves the stored config
     * unchanged (older clients keep working); sending {"enabled": false}
     * turns the push off.
     */
    private LiveSessionAudiencePushConfigDTO audiencePushConfig;

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class NotificationActionDTO {
        private String id; // required for update/delete
        private NotificationTypeEnum type; // ENUM: ON_CREATE, ON_LIVE, BEFORE_LIVE, ATTENDANCE
        private NotifyBy notifyBy;
        private String time; // used only if type == BEFORE_LIVE
        private Boolean notify;
    }

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class NotifyBy {
        private boolean mail;
        private boolean whatsapp;
        private boolean pushNotification;
        private boolean systemNotification;
    }

    @Data
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class CustomFieldDTO {
        private String id;
        private String label;
        private boolean required;
        private boolean isDefault;
        private boolean isHidden;
        private String type;
        private List<FieldOptionDTO> options;
        /**
         * Position in the registration form. The client has always sent this; without the
         * property it was dropped at deserialization, so reordering fields in the builder
         * never reached the database. Null means "leave the stored order alone".
         */
        private Integer formOrder;
    }

    @Data
    public static class FieldOptionDTO {
        private String label;
        private String name;
    }
}
