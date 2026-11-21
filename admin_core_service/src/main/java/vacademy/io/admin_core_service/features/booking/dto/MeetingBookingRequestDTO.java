package vacademy.io.admin_core_service.features.booking.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Admin create-on-behalf meeting booking. When {@code bookingPageId} is set,
 * page defaults (duration, timezone, location, Meet allocation, reminders,
 * booking type) fill any field left null here.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class MeetingBookingRequestDTO {
    private String instituteId;
    private String bookingPageId;
    /** Defaults to the caller when null. */
    private String hostUserId;
    private String title;
    private String description;
    /** ISO-8601 offset datetime, e.g. "2026-07-22T10:00:00+05:30". */
    private String startTime;
    private Integer durationMinutes;
    /** IANA zone the meeting was scheduled in (display zone). */
    private String timezone;

    /** Existing platform users to invite (besides the CRM invitee below). */
    private List<String> participantUserIds;

    /** CRM invitee metadata (all optional for internal meetings). */
    private String inviteeUserId;
    private String audienceResponseId;
    private String inviteeName;
    private String inviteeEmail;
    private String inviteePhone;
    private String inviteeTimezone;

    /** Booking-form custom-field answers, keyed by fieldKey. */
    private Map<String, String> customFieldValues;

    /**
     * Use THIS user's connected Google (Meet + calendar) instead of the host's; when they have not
     * connected one, the institute default is used. Set by the engagement engine.
     */
    private String googleAccountUserId;
    /** Explicit Google account id (blank = institute default); wins over {@code googleAccountUserId}. */
    private String googleAccountId;

    /** Overrides of page defaults. */
    private String locationType;
    private String customMeetingLink;
    private Boolean allocateGoogleMeet;
    private BookingReminderConfigDTO reminderConfig;
}
