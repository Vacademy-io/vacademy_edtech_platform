package vacademy.io.admin_core_service.features.booking.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * One actual booked meeting. The calendar/reminder substrate is the linked
 * {@code live_session} (+ its schedule occurrence); this row carries the
 * CRM/booking metadata on top: invitee identity, audience_response link,
 * invitee self-service manage token, and the booking lifecycle status.
 */
@Entity
@Table(name = "booking_instance")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BookingInstance {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Nullable: admin create-on-behalf bookings need no page. */
    @Column(name = "booking_page_id")
    private String bookingPageId;

    @Column(name = "live_session_id", nullable = false)
    private String liveSessionId;

    @Column(name = "schedule_id")
    private String scheduleId;

    @Column(name = "host_user_id", nullable = false)
    private String hostUserId;

    @Column(name = "invitee_user_id")
    private String inviteeUserId;

    @Column(name = "audience_response_id")
    private String audienceResponseId;

    @Column(name = "invitee_name")
    private String inviteeName;

    @Column(name = "invitee_email")
    private String inviteeEmail;

    @Column(name = "invitee_phone")
    private String inviteePhone;

    @Column(name = "invitee_timezone")
    private String inviteeTimezone;

    @Column(name = "scheduled_start_utc", nullable = false)
    private Timestamp scheduledStartUtc;

    @Column(name = "scheduled_end_utc", nullable = false)
    private Timestamp scheduledEndUtc;

    /** CONFIRMED | PENDING | CANCELLED | RESCHEDULED | COMPLETED | NO_SHOW */
    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "meet_link")
    private String meetLink;

    /** Phase 3: id of the pushed Google Calendar event on the host's calendar. */
    @Column(name = "google_calendar_event_id")
    private String googleCalendarEventId;

    /**
     * Google account the Meet link + calendar event were created under (GoogleAccount.id).
     * null = booked before this was recorded (resolve from the host); blank = institute default.
     */
    @Column(name = "google_account_id")
    private String googleAccountId;

    /** Phase 3: booking-form custom-field answers. */
    @Column(name = "custom_field_values_json")
    private String customFieldValuesJson;

    /** Opaque token letting the invitee reschedule/cancel without login. */
    @Column(name = "manage_token")
    private String manageToken;

    /** Optimistic lock — serializes concurrent invitee reschedule/cancel. */
    @jakarta.persistence.Version
    @Column(name = "version", nullable = false)
    private Long version;

    @Column(name = "reschedule_of_instance_id")
    private String rescheduleOfInstanceId;

    @Column(name = "cancel_reason")
    private String cancelReason;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;
}
