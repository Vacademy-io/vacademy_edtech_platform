package vacademy.io.admin_core_service.features.booking.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.booking.dto.BookingInstanceDTO;
import vacademy.io.admin_core_service.features.booking.dto.MeetingBookingRequestDTO;
import vacademy.io.admin_core_service.features.booking.dto.PublicBookingDTOs;
import vacademy.io.admin_core_service.features.booking.entity.BookingInstance;
import vacademy.io.admin_core_service.features.booking.entity.BookingPage;
import vacademy.io.admin_core_service.features.booking.repository.BookingInstanceRepository;
import vacademy.io.admin_core_service.features.booking.repository.BookingPageRepository;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.live_session.dto.CancelBookingRequest;
import vacademy.io.admin_core_service.features.live_session.repository.ScheduleNotificationRepository;
import vacademy.io.admin_core_service.features.live_session.service.BookingManagementService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleCalendarService;
import vacademy.io.admin_core_service.features.mentorship.service.MentorshipNotificationService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Unauthenticated (public link) booking flow: render page, list slots, book,
 * and invitee self-service via the opaque manage token. All writes funnel into
 * {@link MeetingBookingService} with a minimal host principal, so the public
 * path shares the exact create semantics (wall-clock, reminders, Meet link)
 * with the admin path.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PublicBookingService {

    private static final String SOURCE_TYPE_BOOKING = "AUDIENCE_BOOKING";

    /**
     * Coarse public-endpoint abuse caps: bound confirmation-email blast,
     * host-calendar flooding, Meet-quota spend, and workflow credit burn from
     * the unauthenticated book endpoint. Generous for real traffic.
     */
    private static final int MAX_BOOKINGS_PER_PAGE_PER_DAY = 200;
    private static final int MAX_BOOKINGS_PER_EMAIL_PER_PAGE_PER_DAY = 5;

    private final BookingPageRepository bookingPageRepository;
    private final BookingInstanceRepository bookingInstanceRepository;
    private final BookingPageService bookingPageService;
    private final BookingSlotService bookingSlotService;
    private final MeetingBookingService meetingBookingService;
    private final BookingManagementService bookingManagementService;
    private final ScheduleNotificationRepository scheduleNotificationRepository;
    private final GoogleCalendarService googleCalendarService;
    private final UserGoogleAccountService userGoogleAccountService;
    private final AudienceService audienceService;
    private final AuthService authService;
    private final InstituteCustomFiledService instituteCustomFiledService;
    private final MentorshipNotificationService mentorshipNotificationService;

    public PublicBookingDTOs.PublicPageDTO getPage(String instituteId, String slug) {
        BookingPage page = activePage(instituteId, slug);
        return PublicBookingDTOs.PublicPageDTO.builder()
                .slug(page.getSlug())
                .title(page.getTitle())
                .description(page.getDescription())
                .hostName(hostName(page.getHostUserId()))
                .durationMinutes(page.getDurationMinutes())
                .timezone(page.getTimezone())
                .locationType(page.getLocationType())
                .requireApproval(page.getRequireApproval())
                .minNoticeMinutes(page.getMinNoticeMinutes())
                .bookingHorizonDays(page.getBookingHorizonDays())
                .customFields(customFieldsFor(page))
                .sessionTypes(bookingPageService.readSessionTypes(page))
                .build();
    }

    /**
     * Booking-form fields = the linked audience list's campaign custom fields (if any)
     * PLUS the page's own intake questions (form_fields_json), which have no audience/CRM
     * coupling. Both render identically on the learner form and their answers save to
     * booking_instance.custom_field_values_json.
     */
    private java.util.List<vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO>
            customFieldsFor(BookingPage page) {
        java.util.List<vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO> out =
                new java.util.ArrayList<>();
        if (page.getAudienceId() != null && !page.getAudienceId().isBlank()) {
            try {
                out.addAll(instituteCustomFiledService.findCustomFieldsAsJson(
                        page.getInstituteId(), CustomFieldTypeEnum.AUDIENCE_FORM.name(), page.getAudienceId()));
            } catch (Exception e) {
                log.warn("customFieldsFor page {} failed: {}", page.getId(), e.getMessage());
            }
        }
        java.util.List<vacademy.io.admin_core_service.features.booking.dto.BookingFormFieldDTO> formFields =
                bookingPageService.readFormFields(page);
        if (formFields != null) {
            int order = out.size();
            for (var f : formFields) {
                var cf = toInstituteCustomField(f, order++);
                if (cf != null) out.add(cf);
            }
        }
        return out;
    }

    /** Convert a page intake question into the InstituteCustomFieldDTO shape the learner form consumes. */
    private static vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO toInstituteCustomField(
            vacademy.io.admin_core_service.features.booking.dto.BookingFormFieldDTO f, int order) {
        if (f == null || f.getId() == null || f.getId().isBlank()) return null;
        boolean required = Boolean.TRUE.equals(f.getRequired());
        String config = (f.getOptions() != null && !f.getOptions().isEmpty())
                ? String.join(",", f.getOptions()) : null;
        var cf = vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO.builder()
                .fieldKey(f.getId())
                .fieldName(f.getLabel() != null && !f.getLabel().isBlank() ? f.getLabel() : f.getId())
                .fieldType(f.getFieldType() != null && !f.getFieldType().isBlank() ? f.getFieldType() : "text")
                .config(config)
                .isMandatory(required)
                .formOrder(order)
                .build();
        return vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO.builder()
                .customField(cf)
                .isMandatory(required)
                .individualOrder(order)
                .status("ACTIVE")
                .build();
    }

    public PublicBookingDTOs.SlotsResponseDTO getSlots(String instituteId, String slug,
                                                       String fromDate, String toDate, String displayTz,
                                                       Integer durationMinutes) {
        BookingPage page = activePage(instituteId, slug);
        LocalDate from;
        LocalDate to;
        try {
            from = LocalDate.parse(fromDate);
            to = LocalDate.parse(toDate);
        } catch (Exception e) {
            throw new VacademyException("from/to must be yyyy-MM-dd");
        }
        ZoneId zone = resolveZone(displayTz, page.getTimezone());
        // When a session type is chosen its length overrides the page default so slots
        // fit the actual meeting length.
        Integer effectiveDuration = durationMinutes != null && durationMinutes > 0
                ? durationMinutes : page.getDurationMinutes();
        List<String> slots = bookingSlotService.availableSlots(page, from, to, durationMinutes).stream()
                .map(instant -> instant.atZone(zone).toOffsetDateTime()
                        .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .collect(Collectors.toList());
        return PublicBookingDTOs.SlotsResponseDTO.builder()
                .slots(slots)
                .durationMinutes(effectiveDuration)
                .timezone(zone.getId())
                .build();
    }

    public PublicBookingDTOs.PublicBookingViewDTO book(String instituteId, String slug,
                                                       PublicBookingDTOs.PublicBookRequestDTO request) {
        return book(instituteId, slug, request, null);
    }

    /**
     * Same booking flow, but stamps {@code inviteeUserId} on the booking. Used by
     * authenticated learners booking an assigned mentor so the meeting is tied to
     * their account (My Schedule, reminders, "my bookings") rather than a bare
     * guest email.
     */
    public PublicBookingDTOs.PublicBookingViewDTO book(String instituteId, String slug,
                                                       PublicBookingDTOs.PublicBookRequestDTO request,
                                                       String inviteeUserId) {
        return book(instituteId, slug, request, inviteeUserId, false);
    }

    /**
     * Same booking flow again, with the public-endpoint abuse caps optionally lifted.
     *
     * <p>Those caps exist to bound what an anonymous stranger can do with a public link.
     * A staff-initiated booking — an admin or the mentor themselves scheduling a 1:1 for
     * a named learner — has already passed institute-membership and role checks, so the
     * per-email cap would only ever stop legitimate work (five sessions with the same
     * learner in one day is unusual, but it is not abuse).
     *
     * @param trusted true only for callers the request has already authenticated and
     *                authorized; never set from an unauthenticated entry point.
     */
    public PublicBookingDTOs.PublicBookingViewDTO book(String instituteId, String slug,
                                                       PublicBookingDTOs.PublicBookRequestDTO request,
                                                       String inviteeUserId,
                                                       boolean trusted) {
        BookingPage page = activePage(instituteId, slug);
        if (request.getName() == null || request.getName().isBlank()) {
            throw new VacademyException("name is required");
        }
        boolean hasEmail = request.getEmail() != null && !request.getEmail().isBlank();
        boolean hasPhone = request.getPhone() != null && !request.getPhone().isBlank();
        if (!hasEmail && !hasPhone) {
            throw new VacademyException("email or phone is required");
        }
        Instant slotStart = parseStart(request.getStartTime());
        if (!bookingSlotService.isSlotAvailable(page, slotStart, request.getDurationMinutes())) {
            throw new VacademyException("This slot is no longer available. Please pick another time.");
        }
        if (!trusted) enforceAbuseCaps(page, hasEmail ? request.getEmail() : null);

        // CRM linkage: a public booking on a list-attached page is a lead.
        // Best effort — a broken audience config must not block the meeting.
        String audienceResponseId = null;
        if (page.getAudienceId() != null && !page.getAudienceId().isBlank()) {
            try {
                SubmitLeadRequestDTO lead = new SubmitLeadRequestDTO();
                lead.setAudienceId(page.getAudienceId());
                lead.setSourceType(SOURCE_TYPE_BOOKING);
                lead.setSourceId(page.getId());
                UserDTO userDTO = new UserDTO();
                userDTO.setFullName(request.getName());
                userDTO.setEmail(hasEmail ? request.getEmail() : null);
                userDTO.setMobileNumber(hasPhone ? request.getPhone() : null);
                lead.setUserDTO(userDTO);
                // Custom-field answers persist against the audience_response via
                // the standard lead pipeline → visible in the CRM lead views.
                if (request.getCustomFieldValues() != null && !request.getCustomFieldValues().isEmpty()) {
                    lead.setCustomFieldValues(request.getCustomFieldValues());
                }
                audienceResponseId = audienceService.submitLead(lead);
            } catch (Exception e) {
                log.error("Lead creation for public booking failed (page {}): {}", page.getId(), e.getMessage());
            }
        }

        MeetingBookingRequestDTO booking = MeetingBookingRequestDTO.builder()
                .instituteId(page.getInstituteId())
                .bookingPageId(page.getId())
                .hostUserId(page.getHostUserId())
                .startTime(request.getStartTime())
                .inviteeUserId(inviteeUserId)
                .inviteeName(request.getName())
                .inviteeEmail(hasEmail ? request.getEmail() : null)
                .inviteePhone(hasPhone ? request.getPhone() : null)
                .inviteeTimezone(request.getInviteeTimezone())
                .audienceResponseId(audienceResponseId)
                .customFieldValues(request.getCustomFieldValues())
                .durationMinutes(request.getDurationMinutes())
                .build();
        BookingInstanceDTO created = meetingBookingService.createBooking(booking, hostPrincipal(page));

        BookingInstance instance = bookingInstanceRepository.findById(created.getId())
                .orElseThrow(() -> new VacademyException("Booking not found after create"));
        return toView(instance, page);
    }

    public PublicBookingDTOs.PublicBookingViewDTO getByToken(String manageToken) {
        BookingInstance instance = instanceByToken(manageToken);
        return toView(instance, pageOf(instance));
    }

    @Transactional
    public PublicBookingDTOs.PublicBookingViewDTO cancel(String manageToken,
                                                         PublicBookingDTOs.PublicCancelRequestDTO request) {
        return cancelInstance(instanceByToken(manageToken), request != null ? request.getReason() : null);
    }

    /**
     * Cancel a booking that the caller has ALREADY been authorized to touch.
     *
     * <p>Split out of {@link #cancel(String, PublicBookingDTOs.PublicCancelRequestDTO)} so an
     * authenticated actor (an admin, or the mentor hosting the session) goes through exactly
     * this code — the same mutability guard, the same live-session and reminder teardown, the
     * same Google Calendar cleanup, the same notification. The only difference between the two
     * entry points is how the caller proved they may act; there is no second cancel path.
     *
     * <p>Callers are responsible for authorization: this method performs none.
     */
    @Transactional
    public PublicBookingDTOs.PublicBookingViewDTO cancelInstance(BookingInstance instance, String reason) {
        assertMutable(instance);
        cancelUnderlying(instance, reason);
        notifyMentorshipCancellation(instance);
        return toView(instance, pageOf(instance));
    }

    /**
     * Fire the mentorship cancellation notification (email + in-app + push) once this
     * cancel transaction commits — a no-op unless the host is a mentor. Kept out of the
     * transaction so notification HTTP calls can never roll the cancellation back.
     */
    private void notifyMentorshipCancellation(BookingInstance instance) {
        BookingPage page = pageOf(instance);
        String title = page != null && page.getTitle() != null ? page.getTitle() : "Mentor session";
        ZoneId zone;
        try {
            zone = ZoneId.of(firstNonBlankZone(instance.getInviteeTimezone(),
                    page != null ? page.getTimezone() : null));
        } catch (Exception e) {
            zone = ZoneId.of("Asia/Kolkata");
        }
        String when = instance.getScheduledStartUtc() != null
                ? instance.getScheduledStartUtc().toInstant().atZone(zone)
                        .format(DateTimeFormatter.ofPattern("EEE, dd MMM yyyy 'at' HH:mm")) + " (" + zone.getId() + ")"
                : null;
        final String fTitle = title;
        final String fWhen = when;
        final BookingInstance fInstance = instance;
        Runnable task = () -> mentorshipNotificationService.notifyBooking(
                fInstance.getInstituteId(), fInstance.getHostUserId(), fInstance.getInviteeUserId(),
                fInstance.getInviteeEmail(), fInstance.getInviteePhone(), fInstance.getInviteeName(),
                fTitle, fWhen, true);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        } else {
            task.run();
        }
    }

    private static String firstNonBlankZone(String a, String b) {
        if (a != null && !a.isBlank()) return a;
        if (b != null && !b.isBlank()) return b;
        return "Asia/Kolkata";
    }

    public PublicBookingDTOs.PublicBookingViewDTO reschedule(String manageToken,
                                                             PublicBookingDTOs.PublicRescheduleRequestDTO request) {
        BookingInstance old = instanceByToken(manageToken);
        BookingInstance replacement = rescheduleInstance(old, request);
        return toView(replacement, pageOf(replacement));
    }

    /**
     * Move a booking the caller has ALREADY been authorized to touch, to a new start time.
     *
     * <p>Shares every safeguard with the invitee-facing path: the slot must still be free, the
     * old row is claimed first under its optimistic {@code @Version} (so two concurrent
     * reschedules can't both create a replacement), a failure to create the replacement
     * restores the previous status, and the replacement records {@code rescheduleOfInstanceId}
     * so history stays linked rather than duplicated.
     *
     * <p>Callers are responsible for authorization: this method performs none.
     */
    @Transactional
    public BookingInstance rescheduleInstance(
            BookingInstance old, PublicBookingDTOs.PublicRescheduleRequestDTO request) {
        assertMutable(old);
        BookingPage page = pageOf(old);
        if (page == null || !"ACTIVE".equals(page.getStatus())) {
            throw new VacademyException("This booking can no longer be rescheduled online.");
        }
        Instant newStart = parseStart(request.getStartTime());
        if (!bookingSlotService.isSlotAvailable(page, newStart)) {
            throw new VacademyException("This slot is no longer available. Please pick another time.");
        }

        // Claim the old instance FIRST (optimistic @Version — a concurrent
        // reschedule/cancel loses here instead of double-booking). If creating
        // the replacement then fails, compensate by restoring the old status.
        String previousStatus = old.getStatus();
        old.setStatus("RESCHEDULED");
        try {
            old = bookingInstanceRepository.saveAndFlush(old);
        } catch (org.springframework.dao.OptimisticLockingFailureException e) {
            throw new VacademyException("This booking was just modified. Please reload and try again.");
        }

        MeetingBookingRequestDTO booking = MeetingBookingRequestDTO.builder()
                .instituteId(old.getInstituteId())
                .bookingPageId(page.getId())
                .hostUserId(old.getHostUserId())
                // A rescheduled meeting stays on the Google account it was first booked under.
                .googleAccountId(old.getGoogleAccountId())
                .startTime(request.getStartTime())
                .inviteeName(old.getInviteeName())
                .inviteeEmail(old.getInviteeEmail())
                .inviteePhone(old.getInviteePhone())
                .inviteeTimezone(request.getInviteeTimezone() != null
                        ? request.getInviteeTimezone() : old.getInviteeTimezone())
                .inviteeUserId(old.getInviteeUserId())
                .audienceResponseId(old.getAudienceResponseId())
                .customFieldValues(parseStoredCustomFields(old.getCustomFieldValuesJson()))
                .build();
        BookingInstanceDTO created;
        try {
            // The reschedule sends its own "rescheduled" alert below, not a second "scheduled" one.
            created = MeetingBookingService.withoutStaffAlert(
                    () -> meetingBookingService.createBooking(booking, hostPrincipal(page)));
        } catch (Exception e) {
            old.setStatus(previousStatus);
            bookingInstanceRepository.save(old);
            throw e;
        }

        // Retire the old occurrence's session + reminders (status already RESCHEDULED).
        cancelUnderlying(old, "Rescheduled by invitee", "RESCHEDULED");

        BookingInstance replacement = bookingInstanceRepository.findById(created.getId())
                .orElseThrow(() -> new VacademyException("Booking not found after reschedule"));
        replacement.setRescheduleOfInstanceId(old.getId());
        BookingInstance saved = bookingInstanceRepository.save(replacement);
        try {
            java.time.ZoneId zone = java.time.ZoneId.of(page.getTimezone() == null ? "Asia/Kolkata" : page.getTimezone());
            meetingBookingService.alertStaffAboutMeeting(saved, page.getTitle(), zone, "rescheduled",
                    old.getScheduledStartUtc() == null ? null : old.getScheduledStartUtc().toInstant());
        } catch (Exception e) {
            log.warn("Reschedule {}: staff alert skipped: {}", saved.getId(), e.getMessage());
        }
        return saved;
    }

    // ---------- helpers ----------

    /** Cancels the live-session substrate + reminder rows and marks the instance. */
    private void cancelUnderlying(BookingInstance instance, String reason) {
        cancelUnderlying(instance, reason, "CANCELLED");
    }

    private void cancelUnderlying(BookingInstance instance, String reason, String finalStatus) {
        try {
            CancelBookingRequest cancel = new CancelBookingRequest();
            cancel.setSessionId(instance.getLiveSessionId());
            cancel.setReason(reason);
            bookingManagementService.cancelBooking(cancel, null);
        } catch (Exception e) {
            log.error("Cancelling live session {} failed: {}", instance.getLiveSessionId(), e.getMessage());
        }
        try {
            scheduleNotificationRepository.deleteAllBySessionId(instance.getLiveSessionId());
        } catch (Exception e) {
            log.warn("Deleting reminders for session {} failed: {}", instance.getLiveSessionId(), e.getMessage());
        }
        instance.setStatus(finalStatus);
        instance.setCancelReason(reason);
        bookingInstanceRepository.save(instance);

        // Remove the mirrored Google Calendar event so cancelled/rescheduled slots
        // don't linger on the host's + invitee's calendars (best-effort, scope-gated).
        if (instance.getGoogleCalendarEventId() != null && !instance.getGoogleCalendarEventId().isBlank()) {
            String recorded = instance.getGoogleAccountId();
            // null = booked before the account was recorded → resolve from the host; blank = institute default.
            String accountId = recorded == null
                    ? userGoogleAccountService.resolveAccountId(instance.getInstituteId(), instance.getHostUserId())
                            .orElse(null)
                    : (recorded.isBlank() ? null : recorded);
            googleCalendarService.deleteEvent(instance.getInstituteId(), accountId, instance.getGoogleCalendarEventId());
        }
    }

    /** Coarse anti-abuse caps for the unauthenticated book endpoint. */
    private void enforceAbuseCaps(BookingPage page, String inviteeEmail) {
        java.sql.Timestamp dayAgo = java.sql.Timestamp.from(Instant.now().minusSeconds(24 * 3600L));
        long pageCount = bookingInstanceRepository
                .countByBookingPageIdAndCreatedAtAfter(page.getId(), dayAgo);
        if (pageCount >= MAX_BOOKINGS_PER_PAGE_PER_DAY) {
            throw new VacademyException("This booking page is temporarily unavailable. Please try again later.");
        }
        if (inviteeEmail != null && !inviteeEmail.isBlank()) {
            long emailCount = bookingInstanceRepository
                    .countByBookingPageIdAndInviteeEmailIgnoreCaseAndCreatedAtAfter(
                            page.getId(), inviteeEmail, dayAgo);
            if (emailCount >= MAX_BOOKINGS_PER_EMAIL_PER_PAGE_PER_DAY) {
                throw new VacademyException(
                        "Too many bookings for this email today. Please use your existing booking link.");
            }
        }
    }

    private BookingPage activePage(String instituteId, String slug) {
        return bookingPageRepository.findByInstituteIdAndSlugAndStatus(instituteId, slug, "ACTIVE")
                .orElseThrow(() -> new VacademyException("Booking page not found"));
    }

    private BookingInstance instanceByToken(String manageToken) {
        if (manageToken == null || manageToken.isBlank()) {
            throw new VacademyException("Booking not found");
        }
        return bookingInstanceRepository.findByManageToken(manageToken)
                .orElseThrow(() -> new VacademyException("Booking not found"));
    }

    private void assertMutable(BookingInstance instance) {
        if ("CANCELLED".equals(instance.getStatus()) || "RESCHEDULED".equals(instance.getStatus())) {
            throw new VacademyException("This booking has already been " + instance.getStatus().toLowerCase() + ".");
        }
        if (instance.getScheduledStartUtc().toInstant().isBefore(Instant.now())) {
            throw new VacademyException("This booking is in the past.");
        }
    }

    private BookingPage pageOf(BookingInstance instance) {
        if (instance.getBookingPageId() == null) return null;
        return bookingPageRepository.findById(instance.getBookingPageId()).orElse(null);
    }

    /**
     * Minimal principal acting as the page host — the public caller has no JWT.
     * Only {@code userId} is consumed downstream (Step1 created-by stamping).
     */
    private CustomUserDetails hostPrincipal(BookingPage page) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(page.getHostUserId());
        dto.setUsername("public-booking");
        return new CustomUserDetails(dto);
    }

    private String hostName(String hostUserId) {
        try {
            return authService.getUsersFromAuthServiceByUserIds(List.of(hostUserId)).stream()
                    .findFirst().map(UserDTO::getFullName).orElse(null);
        } catch (Exception e) {
            log.warn("hostName lookup failed: {}", e.getMessage());
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private static java.util.Map<String, String> parseStoredCustomFields(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, java.util.Map.class);
        } catch (Exception e) {
            return null;
        }
    }

    private static Instant parseStart(String startTime) {
        try {
            return OffsetDateTime.parse(startTime).toInstant();
        } catch (Exception e) {
            throw new VacademyException("start_time must be an ISO-8601 offset datetime");
        }
    }

    private static ZoneId resolveZone(String requested, String fallback) {
        if (requested != null && !requested.isBlank()) {
            try {
                return ZoneId.of(requested);
            } catch (Exception ignored) {
                // fall through to the page zone
            }
        }
        return ZoneId.of(fallback);
    }

    private PublicBookingDTOs.PublicBookingViewDTO toView(BookingInstance instance, BookingPage page) {
        return PublicBookingDTOs.PublicBookingViewDTO.builder()
                .manageToken(instance.getManageToken())
                .pageSlug(page != null ? page.getSlug() : null)
                .title(page != null ? page.getTitle() : "Meeting")
                .hostName(hostName(instance.getHostUserId()))
                .inviteeName(instance.getInviteeName())
                .inviteeEmail(instance.getInviteeEmail())
                .status(instance.getStatus())
                .meetLink(instance.getMeetLink())
                .startTimeUtc(instance.getScheduledStartUtc().toInstant().toString())
                .endTimeUtc(instance.getScheduledEndUtc().toInstant().toString())
                .inviteeTimezone(instance.getInviteeTimezone())
                .build();
    }
}
