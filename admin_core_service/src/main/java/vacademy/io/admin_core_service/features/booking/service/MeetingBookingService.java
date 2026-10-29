package vacademy.io.admin_core_service.features.booking.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.booking.dto.BookingInstanceDTO;
import vacademy.io.admin_core_service.features.booking.dto.BookingReminderConfigDTO;
import vacademy.io.admin_core_service.features.booking.dto.MeetingBookingRequestDTO;
import vacademy.io.admin_core_service.features.booking.entity.BookingInstance;
import vacademy.io.admin_core_service.features.booking.entity.BookingPage;
import vacademy.io.admin_core_service.features.booking.repository.BookingInstanceRepository;
import vacademy.io.admin_core_service.features.live_session.dto.CreateBookingRequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep2RequestDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.enums.NotificationTypeEnum;
import vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderMeetingCreateRequestDTO;
import vacademy.io.admin_core_service.features.live_session.provider.service.ProviderMeetingBatchService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleCalendarService;
import vacademy.io.admin_core_service.features.mentorship.repository.MentorRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.service.Step1Service;
import vacademy.io.admin_core_service.features.live_session.service.Step2Service;
import vacademy.io.admin_core_service.features.mentorship.service.MentorshipNotificationService;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification_service.service.BrandedEmailService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.util.PhoneCountryUtil;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Creates and lists meeting bookings. A booking = one live_session row (the
 * calendar/reminder substrate, created through the existing Step1/Step2 flow)
 * plus one booking_instance row (CRM metadata: page, invitee, manage token).
 *
 * <p>Transaction shape: the persistence phase (session + schedule + participants
 * + reminder rows + booking_instance) commits FIRST via {@link TransactionTemplate};
 * Google Meet allocation and the confirmation email run AFTER commit, so a
 * provider outage or misconfigured Google account can never roll the booking
 * back (the Meet retry processor re-provisions pending schedules on its own).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MeetingBookingService {

    private static final String SOURCE_MEETING_BOOKING = "MEETING_BOOKING";
    private static final int MIN_DURATION_MINUTES = 5;
    private static final int MAX_DURATION_MINUTES = 8 * 60;

    private final BookingPageService bookingPageService;
    private final BookingInstanceRepository bookingInstanceRepository;
    private final Step1Service step1Service;
    private final Step2Service step2Service;
    private final SessionScheduleRepository sessionScheduleRepository;
    private final ProviderMeetingBatchService providerMeetingBatchService;
    private final GoogleCalendarService googleCalendarService;
    private final MentorRepository mentorRepository;
    private final AuthService authService;
    private final NotificationService notificationService;
    private final MentorshipNotificationService mentorshipNotificationService;
    private final BrandedEmailService brandedEmailService;
    private final PlatformTransactionManager transactionManager;

    public BookingInstanceDTO createBooking(MeetingBookingRequestDTO request, CustomUserDetails user) {
        if (request.getInstituteId() == null || request.getInstituteId().isBlank()) {
            throw new VacademyException("institute_id is required");
        }
        if (request.getStartTime() == null || request.getStartTime().isBlank()) {
            throw new VacademyException("start_time is required");
        }

        BookingPage page = request.getBookingPageId() != null && !request.getBookingPageId().isBlank()
                ? bookingPageService.getOrThrow(request.getBookingPageId())
                : null;
        if (page != null && !request.getInstituteId().equals(page.getInstituteId())) {
            throw new VacademyException("Booking page does not belong to this institute");
        }

        String hostUserId = firstNonBlank(request.getHostUserId(),
                page != null ? page.getHostUserId() : null, user.getUserId());
        String title = firstNonBlank(request.getTitle(), page != null ? page.getTitle() : null, "Meeting");
        int duration = request.getDurationMinutes() != null ? request.getDurationMinutes()
                : (page != null && page.getDurationMinutes() != null ? page.getDurationMinutes() : 30);
        if (duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
            throw new VacademyException("duration_minutes must be between "
                    + MIN_DURATION_MINUTES + " and " + MAX_DURATION_MINUTES);
        }
        String timezone = firstNonBlank(request.getTimezone(),
                page != null ? page.getTimezone() : null, "Asia/Kolkata");
        String locationType = firstNonBlank(request.getLocationType(),
                page != null ? page.getLocationType() : null, "GOOGLE_MEET");
        String customLink = firstNonBlank(request.getCustomMeetingLink(),
                page != null ? page.getCustomMeetingLink() : null, null);
        boolean allocateMeet = request.getAllocateGoogleMeet() != null
                ? request.getAllocateGoogleMeet()
                : (page != null && Boolean.TRUE.equals(page.getAllocateGoogleMeet()));

        OffsetDateTime start;
        try {
            start = OffsetDateTime.parse(request.getStartTime());
        } catch (Exception e) {
            throw new VacademyException("start_time must be an ISO-8601 offset datetime");
        }
        ZoneId zone;
        try {
            zone = ZoneId.of(timezone);
        } catch (Exception e) {
            throw new VacademyException("timezone must be a valid IANA zone id");
        }
        OffsetDateTime end = start.plusMinutes(duration);

        requireNoOtherMeetingThatDay(request, start, zone);

        BookingReminderConfigDTO reminderConfig = request.getReminderConfig() != null
                ? request.getReminderConfig()
                : (page != null ? bookingPageService.readReminderConfig(page) : null);

        // ---- Phase 1 (transactional): session + schedule + participants + instance ----
        final BookingPage pageRef = page;
        final String customLinkRef = customLink;
        final boolean allocateMeetRef = allocateMeet;
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        BookingInstance instance;
        try {
            instance = tx.execute(status -> persistBooking(
                    request, user, pageRef, hostUserId, title, duration, timezone, zone,
                    locationType, customLinkRef, allocateMeetRef, start, end, reminderConfig));
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            // uq_booking_instance_page_slot violated: another invitee grabbed this
            // exact slot between the availability check and our insert. The whole
            // transaction (session + schedule + instance) rolled back.
            throw new VacademyException("This slot was just booked. Please pick another time.");
        }

        // ---- Phase 2 (post-commit, best effort): Meet link + Calendar push + confirmation email ----
        if (allocateMeet) {
            instance = allocateMeetLink(instance, title, duration, timezone);
        }
        if ("CONFIRMED".equals(instance.getStatus())) {
            instance = pushCalendarEvent(instance, title, timezone, request.getParticipantUserIds());
        }
        sendConfirmationEmail(instance, title, zone, reminderConfig);
        sendConfirmationWhatsapp(instance, title, zone, reminderConfig);
        // Mentorship-only extra channels (in-app bell + push). No-op unless the host
        // is a mentor; the confirmation email above already covers the email channel.
        mentorshipNotificationService.notifyBooking(instance.getInstituteId(), instance.getHostUserId(),
                instance.getInviteeUserId(), instance.getInviteeEmail(), instance.getInviteePhone(),
                instance.getInviteeName(), title, formatWhen(instance, zone), false);

        return toDTO(instance, Map.of(), page != null ? page.getTitle() : null);
    }

    /**
     * One meeting per person per day. The same lead was booked twice for one morning (11:30
     * by hand, 10:00 from the call) and received two invites; a second meeting that day is
     * refused so the existing one is rescheduled instead. A reschedule is not affected: it
     * marks the old instance RESCHEDULED before creating the new one.
     */
    void requireNoOtherMeetingThatDay(MeetingBookingRequestDTO request, OffsetDateTime start, ZoneId zone) {
        String responseId = blankToNull(request.getAudienceResponseId());
        String userId = blankToNull(request.getInviteeUserId());
        String phone10 = phone10(request.getInviteePhone());
        String email = request.getInviteeEmail() == null || request.getInviteeEmail().isBlank()
                ? null : request.getInviteeEmail().trim().toLowerCase();
        if (responseId == null && userId == null && phone10 == null && email == null) return;
        java.time.ZonedDateTime dayStart = start.atZoneSameInstant(zone).toLocalDate().atStartOfDay(zone);
        List<BookingInstance> sameDay = bookingInstanceRepository.findLiveBookingsOfPersonBetween(
                request.getInstituteId(), responseId, userId, phone10, email,
                java.sql.Timestamp.from(dayStart.toInstant()),
                java.sql.Timestamp.from(dayStart.plusDays(1).toInstant()));
        if (sameDay.isEmpty()) return;
        BookingInstance existing = sameDay.get(0);
        String who = firstNonBlank(request.getInviteeName(), existing.getInviteeName(), "This person");
        String when = existing.getScheduledStartUtc() == null ? "that day"
                : java.time.format.DateTimeFormatter.ofPattern("EEE d MMM 'at' h:mm a", java.util.Locale.ENGLISH)
                        .format(existing.getScheduledStartUtc().toInstant().atZone(zone));
        throw new vacademy.io.common.exceptions.ConflictException(who + " already has a meeting on " + when
                + ". Reschedule or cancel that one instead of booking a second meeting the same day.");
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String phone10(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        return digits.length() >= 10 ? digits.substring(digits.length() - 10) : null;
    }

    private BookingInstance persistBooking(MeetingBookingRequestDTO request, CustomUserDetails user,
                                           BookingPage page, String hostUserId, String title, int duration,
                                           String timezone, ZoneId zone, String locationType, String customLink,
                                           boolean allocateMeet, OffsetDateTime start, OffsetDateTime end,
                                           BookingReminderConfigDTO reminderConfig) {
        // Live-session convention (see Step1Service): session.startTime holds the
        // WALL-CLOCK value in session.timezone — extracted via .atZone(UTC). So we
        // convert the incoming instant to wall-clock in the page timezone before
        // handing it to Step1; reminder triggers and email rendering both depend
        // on this. BookingInstance keeps the true UTC instants separately.
        Timestamp startWallClock = Timestamp.valueOf(start.atZoneSameInstant(zone).toLocalDateTime());
        Timestamp endWallClock = Timestamp.valueOf(end.atZoneSameInstant(zone).toLocalDateTime());

        // ---- Step 1: session + schedule ----
        CreateBookingRequestDTO step1 = new CreateBookingRequestDTO();
        step1.setInstituteId(request.getInstituteId());
        step1.setTitle(title);
        step1.setSubject(title);
        step1.setDescriptionHtml(request.getDescription());
        step1.setStartTime(startWallClock);
        step1.setLastEntryTime(endWallClock);
        step1.setSessionEndDate(start.atZoneSameInstant(zone).toLocalDate().toString());
        step1.setTimeZone(timezone);
        step1.setBookingTypeId(page != null ? page.getBookingTypeId() : null);
        step1.setSource(SOURCE_MEETING_BOOKING);
        step1.setSourceId(page != null ? page.getId() : request.getAudienceResponseId());
        if ("CUSTOM_LINK".equalsIgnoreCase(locationType) && customLink != null && !allocateMeet) {
            step1.setDefaultMeetLink(customLink);
        }
        LiveSession session = step1Service.step1AddService(step1, user);

        // ---- Step 2: participants + BEFORE_LIVE reminder rows ----
        // The host joins as a participant; the on-booking confirmation is sent
        // directly by this service post-commit (the live-class ON_CREATE path
        // resolves recipients from student tables, which CRM invitees and staff
        // hosts are usually not in).
        Set<String> participantIds = new LinkedHashSet<>();
        if (request.getParticipantUserIds() != null) participantIds.addAll(request.getParticipantUserIds());
        if (request.getInviteeUserId() != null && !request.getInviteeUserId().isBlank()) {
            participantIds.add(request.getInviteeUserId());
        }
        participantIds.add(hostUserId);
        LiveSessionStep2RequestDTO step2 = new LiveSessionStep2RequestDTO();
        step2.setSessionId(session.getId());
        step2.setAccessType("PRIVATE");
        step2.setIndividualUserIds(new ArrayList<>(participantIds));
        step2.setAddedNotificationActions(buildNotificationActions(reminderConfig));
        step2Service.step2AddService(step2, user);

        String scheduleId = sessionScheduleRepository.findBySessionId(session.getId()).stream()
                .findFirst().map(SessionSchedule::getId).orElse(null);

        BookingInstance instance = BookingInstance.builder()
                .instituteId(request.getInstituteId())
                .bookingPageId(page != null ? page.getId() : null)
                .liveSessionId(session.getId())
                .scheduleId(scheduleId)
                .hostUserId(hostUserId)
                .inviteeUserId(request.getInviteeUserId())
                .audienceResponseId(request.getAudienceResponseId())
                .inviteeName(request.getInviteeName())
                .inviteeEmail(request.getInviteeEmail())
                .inviteePhone(request.getInviteePhone())
                .inviteeTimezone(firstNonBlank(request.getInviteeTimezone(), timezone, null))
                .scheduledStartUtc(Timestamp.from(start.toInstant()))
                .scheduledEndUtc(Timestamp.from(end.toInstant()))
                .status(page != null && Boolean.TRUE.equals(page.getRequireApproval()) ? "PENDING" : "CONFIRMED")
                .meetLink("CUSTOM_LINK".equalsIgnoreCase(locationType) || !allocateMeet ? customLink : null)
                .customFieldValuesJson(writeCustomFieldValues(request.getCustomFieldValues()))
                .manageToken(UUID.randomUUID().toString())
                .build();
        try {
            // saveAndFlush, not save: the insert must hit the database HERE so a lost
            // race surfaces as a constraint violation we can translate, rather than
            // blowing up later at commit with an opaque error.
            return bookingInstanceRepository.saveAndFlush(instance);
        } catch (DataIntegrityViolationException e) {
            // uq_booking_host_slot (V458): someone else took this exact slot between
            // the availability check and this insert. Same wording as the pre-check,
            // because to the invitee it is the same situation.
            if (isSlotCollision(e)) {
                throw new VacademyException("This slot is no longer available. Please pick another time.");
            }
            throw e;
        }
    }

    /** True when the failure is the host/slot uniqueness guard rather than any other constraint. */
    private static boolean isSlotCollision(DataIntegrityViolationException e) {
        String detail = String.valueOf(e.getMostSpecificCause() == null
                ? e.getMessage() : e.getMostSpecificCause().getMessage());
        return detail != null && detail.contains("uq_booking_host_slot");
    }

    /** Post-commit Meet allocation; failures leave the booking intact (retry processor re-provisions). */
    private BookingInstance allocateMeetLink(BookingInstance instance, String title, int duration, String timezone) {
        try {
            providerMeetingBatchService.createMeetingsForSession(ProviderMeetingCreateRequestDTO.builder()
                    .instituteId(instance.getInstituteId())
                    .sessionId(instance.getLiveSessionId())
                    .provider("GOOGLE_MEET")
                    .topic(title)
                    .durationMinutes(duration)
                    .timezone(timezone)
                    // Per-mentor Google: mint the Meet under the mentor's own account when
                    // connected; null → institute default (unchanged behavior).
                    .providerAccountId(hostGoogleAccountId(instance.getInstituteId(), instance.getHostUserId()))
                    .build());
            String meetLink = sessionScheduleRepository.findBySessionId(instance.getLiveSessionId()).stream()
                    .map(SessionSchedule::getCustomMeetingLink)
                    .filter(l -> l != null && !l.isBlank())
                    .findFirst()
                    .orElse(null);
            if (meetLink != null) {
                instance.setMeetLink(meetLink);
                instance = bookingInstanceRepository.save(instance);
            }
        } catch (Exception e) {
            log.error("Google Meet allocation failed for session {}: {}",
                    instance.getLiveSessionId(), e.getMessage());
        }
        return instance;
    }

    /**
     * Post-commit one-way Google Calendar push: create an event on the institute's
     * connected Google account with the host + invitee as attendees (sendUpdates=all),
     * so the booking reflects on both calendars. Internal participants picked in the
     * New Meeting dialog are invited too. Scope-gated and best-effort inside
     * {@link GoogleCalendarService} — a booking is never rolled back if this fails,
     * and institutes without Calendar consent are simply skipped.
     */
    private BookingInstance pushCalendarEvent(BookingInstance instance, String title, String timezone,
                                              List<String> participantUserIds) {
        try {
            List<String> attendees = new ArrayList<>();
            if (instance.getInviteeEmail() != null && !instance.getInviteeEmail().isBlank()) {
                attendees.add(instance.getInviteeEmail());
            }
            Set<String> staffIds = new LinkedHashSet<>();
            staffIds.add(instance.getHostUserId());
            if (participantUserIds != null) {
                participantUserIds.stream().filter(id -> id != null && !id.isBlank()).forEach(staffIds::add);
            }
            try {
                authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(staffIds)).stream()
                        .map(u -> u.getEmail())
                        .filter(e -> e != null && !e.isBlank())
                        .forEach(attendees::add);
            } catch (Exception ignore) {
                // host/participant emails are best-effort — the event still lands with the invitee
            }
            String description = "Booking with " + firstNonBlank(instance.getInviteeName(), "invitee", "");
            Optional<String> eventId = googleCalendarService.createEvent(
                    instance.getInstituteId(),
                    hostGoogleAccountId(instance.getInstituteId(), instance.getHostUserId()),
                    title, description,
                    instance.getScheduledStartUtc().toInstant(), instance.getScheduledEndUtc().toInstant(),
                    timezone, attendees, instance.getMeetLink());
            if (eventId.isPresent()) {
                instance.setGoogleCalendarEventId(eventId.get());
                instance = bookingInstanceRepository.save(instance);
            }
        } catch (Exception e) {
            log.error("Google Calendar push failed for booking {}: {}", instance.getId(), e.getMessage());
        }
        return instance;
    }

    /** The Google account the booking's host mentor connected (null → institute default). */
    private String hostGoogleAccountId(String instituteId, String hostUserId) {
        if (instituteId == null || hostUserId == null) return null;
        try {
            return mentorRepository
                    .findByInstituteIdAndUserIdAndStatusNot(instituteId, hostUserId, "DELETED")
                    .map(vacademy.io.admin_core_service.features.mentorship.entity.Mentor::getGoogleAccountId)
                    .filter(id -> id != null && !id.isBlank())
                    .orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    /** Direct on-booking confirmation to the invitee's email + the host, best effort. */
    private void sendConfirmationEmail(BookingInstance instance, String title, ZoneId zone,
                                       BookingReminderConfigDTO config) {
        boolean enabled = config == null || !Boolean.FALSE.equals(config.getOnBookingConfirmation());
        List<String> channels = config != null && config.getChannels() != null && !config.getChannels().isEmpty()
                ? config.getChannels() : List.of("EMAIL");
        if (!enabled || !channels.contains("EMAIL")) return;
        try {
            List<NotificationToUserDTO> recipients = new ArrayList<>();
            if (instance.getInviteeEmail() != null && !instance.getInviteeEmail().isBlank()) {
                recipients.add(recipient(instance.getInviteeEmail(), instance.getInviteeUserId(),
                        firstNonBlank(instance.getInviteeName(), "there", null)));
            }
            try {
                authService.getUsersFromAuthServiceByUserIds(List.of(instance.getHostUserId())).stream()
                        .filter(u -> u.getEmail() != null && !u.getEmail().isBlank())
                        .findFirst()
                        .ifPresent(host -> recipients.add(
                                recipient(host.getEmail(), host.getId(),
                                        firstNonBlank(host.getFullName(), "there", null))));
            } catch (Exception e) {
                log.warn("Host lookup for confirmation email failed: {}", e.getMessage());
            }
            if (recipients.isEmpty()) return;

            boolean pending = "PENDING".equals(instance.getStatus());
            String when = instance.getScheduledStartUtc().toInstant().atZone(zone)
                    .format(DateTimeFormatter.ofPattern("EEE, dd MMM yyyy 'at' HH:mm"))
                    + " (" + zone.getId() + ")";
            String statusLabel = pending ? "awaiting confirmation" : "confirmed";

            // Prefer the branded DB template (institute override -> DEFAULT seed, V425), rendered
            // per-recipient so the invitee AND the host each get a professional themed email.
            if (brandedEmailService.hasEmailTemplate(instance.getInstituteId(), "Booking Confirmation")) {
                String joinButton = "";
                if (instance.getMeetLink() != null && !instance.getMeetLink().isBlank()) {
                    joinButton = "<table cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 0 22px;\">"
                            + "<tr><td style=\"border-radius:8px;background:{{institute_theme_color}};\">"
                            + "<a href=\"" + instance.getMeetLink()
                            + "\" style=\"display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;"
                            + "color:#ffffff;text-decoration:none;border-radius:8px;\">Join meeting</a></td></tr></table>";
                }
                Map<String, String> vars = new HashMap<>();
                vars.put("meeting_title", title);
                vars.put("session_datetime", when);
                vars.put("status_label", statusLabel);
                vars.put("join_button", joinButton);
                vars.put("meet_link", instance.getMeetLink() != null ? instance.getMeetLink() : "");
                for (NotificationToUserDTO r : recipients) {
                    String rName = r.getPlaceholders() != null
                            ? r.getPlaceholders().getOrDefault("name", "there") : "there";
                    brandedEmailService.sendBrandedEmail(instance.getInstituteId(), r.getChannelId(),
                            rName, "Booking Confirmation", vars);
                }
                return;
            }

            // Fallback: plain inline body (only when no template row exists).
            StringBuilder body = new StringBuilder()
                    .append("<p>Hi {{name}},</p>")
                    .append("<p>Your meeting <b>").append(title).append("</b> is ")
                    .append(statusLabel)
                    .append(" for <b>").append(when).append("</b>.</p>");
            if (instance.getMeetLink() != null && !instance.getMeetLink().isBlank()) {
                body.append("<p>Join link: <a href=\"").append(instance.getMeetLink()).append("\">")
                        .append(instance.getMeetLink()).append("</a></p>");
            }

            NotificationDTO dto = new NotificationDTO();
            dto.setSubject((pending ? "Meeting requested: " : "Meeting confirmed: ") + title);
            dto.setBody(body.toString());
            dto.setNotificationType("BOOKING_CONFIRMATION");
            dto.setSource(SOURCE_MEETING_BOOKING);
            dto.setSourceId(instance.getId());
            dto.setUsers(recipients);
            notificationService.sendEmailViaUnified(dto, instance.getInstituteId());
        } catch (Exception e) {
            log.error("Booking confirmation email failed for instance {}: {}", instance.getId(), e.getMessage());
        }
    }

    /**
     * WhatsApp confirmation on booking, sent through the unified send path with the
     * institute's chosen approved template. Best-effort (like the email): a missing
     * template / phone / provider error is logged and never fails the booking. Runs
     * post-persist. Covers BOTH booking-page bookings and AI-call auto-bookings, since
     * both flow through createBooking with the page's reminder config.
     */
    private void sendConfirmationWhatsapp(BookingInstance instance, String title, ZoneId zone,
                                          BookingReminderConfigDTO config) {
        boolean enabled = config == null || !Boolean.FALSE.equals(config.getOnBookingConfirmation());
        List<String> channels = config != null && config.getChannels() != null
                ? config.getChannels() : List.of();
        if (!enabled || !channels.contains("WHATSAPP")) return;
        if (config == null || config.getWhatsappTemplateName() == null
                || config.getWhatsappTemplateName().isBlank()) {
            log.info("Booking {} has WHATSAPP channel but no template configured — skipping WA confirmation",
                    instance.getId());
            return;
        }
        String phone = instance.getInviteePhone();
        if (phone == null || phone.isBlank()) {
            log.info("Booking {} WHATSAPP confirmation skipped — invitee has no phone", instance.getId());
            return;
        }
        try {
            java.util.Map<String, String> resolved = resolveWhatsappVariables(instance, title, zone, config);
            String normalized = PhoneCountryUtil.normalizePhone(phone, true);
            UnifiedSendRequest.Recipient recipient = UnifiedSendRequest.Recipient.builder()
                    .phone(normalized)
                    .userId(instance.getInviteeUserId())
                    .name(firstNonBlank(instance.getInviteeName(), "there", null))
                    .variables(resolved)
                    .build();
            UnifiedSendRequest req = UnifiedSendRequest.builder()
                    .instituteId(instance.getInstituteId())
                    .channel("WHATSAPP")
                    .templateName(config.getWhatsappTemplateName())
                    .languageCode(firstNonBlank(config.getWhatsappLanguageCode(), "en", "en"))
                    .recipients(List.of(recipient))
                    .build();
            notificationService.sendUnified(req);
            log.info("Booking {} WHATSAPP confirmation sent via template {}",
                    instance.getId(), config.getWhatsappTemplateName());
        } catch (Exception e) {
            log.error("Booking {} WHATSAPP confirmation failed: {}", instance.getId(), e.getMessage());
        }
    }

    /** Resolve each mapped template variable to a value from the booking. */
    private java.util.Map<String, String> resolveWhatsappVariables(
            BookingInstance instance, String title, ZoneId zone, BookingReminderConfigDTO config) {
        java.util.Map<String, String> out = new java.util.HashMap<>();
        java.util.Map<String, String> mapping = config.getWhatsappVariableMapping();
        if (mapping == null || mapping.isEmpty()) return out;

        java.time.ZonedDateTime when = instance.getScheduledStartUtc().toInstant().atZone(zone);
        String dateStr = when.format(DateTimeFormatter.ofPattern("dd MMM yyyy"));
        String timeStr = when.format(DateTimeFormatter.ofPattern("HH:mm")) + " (" + zone.getId() + ")";
        String dateTimeStr = when.format(DateTimeFormatter.ofPattern("EEE, dd MMM yyyy 'at' HH:mm"))
                + " (" + zone.getId() + ")";
        long durationMin = instance.getScheduledEndUtc() != null
                ? java.time.Duration.between(instance.getScheduledStartUtc().toInstant(),
                        instance.getScheduledEndUtc().toInstant()).toMinutes() : 0;

        String hostName = null;
        boolean needsHost = mapping.values().stream().anyMatch(v -> "host_name".equals(v));
        if (needsHost) {
            try {
                hostName = authService.getUsersFromAuthServiceByUserIds(List.of(instance.getHostUserId()))
                        .stream().findFirst().map(u -> u.getFullName()).orElse(null);
            } catch (Exception ignore) { /* host name is optional */ }
        }

        for (java.util.Map.Entry<String, String> e : mapping.entrySet()) {
            String var = e.getKey();
            String src = e.getValue() == null ? "" : e.getValue().trim();
            String val;
            if (src.startsWith("static:")) {
                val = src.substring("static:".length());
            } else {
                switch (src) {
                    case "invitee_name": val = firstNonBlank(instance.getInviteeName(), "there", "there"); break;
                    case "meeting_title": val = title != null ? title : "your meeting"; break;
                    case "meeting_datetime": val = dateTimeStr; break;
                    case "meeting_date": val = dateStr; break;
                    case "meeting_time": val = timeStr; break;
                    case "meet_link": val = firstNonBlank(instance.getMeetLink(), "", ""); break;
                    case "host_name": val = firstNonBlank(hostName, "our team", "our team"); break;
                    case "duration_minutes": val = String.valueOf(durationMin); break;
                    default: val = ""; // unmapped/unknown -> empty (Meta rejects nulls)
                }
            }
            out.put(var, val == null ? "" : val);
        }
        return out;
    }

    /** Human-readable start time in the booking's zone, e.g. "Mon, 04 Aug 2026 at 15:30 (Asia/Kolkata)". */
    private static String formatWhen(BookingInstance instance, ZoneId zone) {
        if (instance.getScheduledStartUtc() == null) return null;
        return instance.getScheduledStartUtc().toInstant().atZone(zone)
                .format(DateTimeFormatter.ofPattern("EEE, dd MMM yyyy 'at' HH:mm")) + " (" + zone.getId() + ")";
    }

    private static NotificationToUserDTO recipient(String email, String userId, String name) {
        NotificationToUserDTO user = new NotificationToUserDTO();
        user.setChannelId(email);
        user.setUserId(userId);
        Map<String, String> placeholders = new HashMap<>();
        placeholders.put("name", name);
        user.setPlaceholders(placeholders);
        return user;
    }

    /** Bookings hosted by any of {@code hostUserIds} inside [start, end]. */
    public List<BookingInstanceDTO> listForHosts(String instituteId, Collection<String> hostUserIds,
                                                 Timestamp windowStart, Timestamp windowEnd) {
        if (hostUserIds == null || hostUserIds.isEmpty()) return List.of();
        return enrich(bookingInstanceRepository.findForHostsInWindow(
                instituteId, hostUserIds, windowStart, windowEnd));
    }

    /** All bookings of the institute inside [start, end] — admin Team Meetings view. */
    public List<BookingInstanceDTO> listForInstitute(String instituteId,
                                                     Timestamp windowStart, Timestamp windowEnd) {
        return enrich(bookingInstanceRepository.findForInstituteInWindow(instituteId, windowStart, windowEnd));
    }

    /**
     * A lead's meetings for the CRM lead view — union of bookings linked to the
     * audience_response, the lead's platform user, and the lead's email (public
     * bookings on other lists carry the same contact but a different response id).
     */
    public List<BookingInstanceDTO> listForLead(String instituteId, String audienceResponseId,
                                                String inviteeUserId, String inviteeEmail) {
        Map<String, BookingInstance> byId = new java.util.LinkedHashMap<>();
        if (audienceResponseId != null && !audienceResponseId.isBlank()) {
            bookingInstanceRepository.findByAudienceResponseId(audienceResponseId).stream()
                    .filter(b -> instituteId.equals(b.getInstituteId()))
                    .forEach(b -> byId.put(b.getId(), b));
        }
        if (inviteeUserId != null && !inviteeUserId.isBlank()) {
            bookingInstanceRepository
                    .findByInstituteIdAndInviteeUserIdOrderByScheduledStartUtcDesc(instituteId, inviteeUserId)
                    .forEach(b -> byId.put(b.getId(), b));
        }
        if (inviteeEmail != null && !inviteeEmail.isBlank()) {
            bookingInstanceRepository
                    .findByInstituteIdAndInviteeEmailIgnoreCaseOrderByScheduledStartUtcDesc(instituteId, inviteeEmail)
                    .forEach(b -> byId.put(b.getId(), b));
        }
        List<BookingInstance> rows = new ArrayList<>(byId.values());
        rows.sort(java.util.Comparator.comparing(BookingInstance::getScheduledStartUtc).reversed());
        return enrich(rows);
    }

    private List<BookingInstanceDTO> enrich(List<BookingInstance> rows) {
        Map<String, String> hostNames = userNames(rows.stream()
                .map(BookingInstance::getHostUserId).distinct().collect(Collectors.toList()));
        return rows.stream().map(r -> toDTO(r, hostNames, null)).collect(Collectors.toList());
    }

    // ---------- helpers ----------

    private List<LiveSessionStep2RequestDTO.NotificationActionDTO> buildNotificationActions(
            BookingReminderConfigDTO config) {
        // Only BEFORE_LIVE reminder rows here (works for enrolled participants);
        // the on-booking confirmation is sent directly post-commit instead of via
        // the live-class ON_CREATE path — see persistBooking.
        List<String> channels = config != null && config.getChannels() != null && !config.getChannels().isEmpty()
                ? config.getChannels() : List.of("EMAIL");
        List<Integer> offsets = config != null && config.getBeforeMeetingOffsetsMinutes() != null
                ? config.getBeforeMeetingOffsetsMinutes() : List.of(60);

        LiveSessionStep2RequestDTO.NotifyBy notifyBy = new LiveSessionStep2RequestDTO.NotifyBy();
        notifyBy.setMail(channels.contains("EMAIL"));
        notifyBy.setWhatsapp(channels.contains("WHATSAPP"));

        List<LiveSessionStep2RequestDTO.NotificationActionDTO> actions = new ArrayList<>();
        for (Integer offset : offsets) {
            if (offset == null || offset <= 0) continue;
            LiveSessionStep2RequestDTO.NotificationActionDTO beforeLive =
                    new LiveSessionStep2RequestDTO.NotificationActionDTO();
            beforeLive.setType(NotificationTypeEnum.BEFORE_LIVE);
            beforeLive.setNotify(true);
            beforeLive.setNotifyBy(notifyBy);
            beforeLive.setTime(String.valueOf(offset));
            actions.add(beforeLive);
        }
        return actions;
    }

    private Map<String, String> userNames(List<String> userIds) {
        Map<String, String> out = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) return out;
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(userIds)) {
                if (u.getId() != null) out.put(u.getId(), u.getFullName());
            }
        } catch (Exception e) {
            log.warn("userNames failed: {}", e.getMessage());
        }
        return out;
    }

    private String writeCustomFieldValues(Map<String, String> values) {
        if (values == null || values.isEmpty()) return null;
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(values);
        } catch (Exception e) {
            log.warn("Serializing booking custom fields failed: {}", e.getMessage());
            return null;
        }
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }

    private BookingInstanceDTO toDTO(BookingInstance b, Map<String, String> hostNames, String pageTitle) {
        return BookingInstanceDTO.builder()
                .id(b.getId())
                .instituteId(b.getInstituteId())
                .bookingPageId(b.getBookingPageId())
                .bookingPageTitle(pageTitle)
                .liveSessionId(b.getLiveSessionId())
                .scheduleId(b.getScheduleId())
                .hostUserId(b.getHostUserId())
                .hostName(hostNames.get(b.getHostUserId()))
                .inviteeUserId(b.getInviteeUserId())
                .audienceResponseId(b.getAudienceResponseId())
                .inviteeName(b.getInviteeName())
                .inviteeEmail(b.getInviteeEmail())
                .inviteePhone(b.getInviteePhone())
                .inviteeTimezone(b.getInviteeTimezone())
                .scheduledStartUtc(b.getScheduledStartUtc())
                .scheduledEndUtc(b.getScheduledEndUtc())
                .status(b.getStatus())
                .meetLink(b.getMeetLink())
                .cancelReason(b.getCancelReason())
                .customFieldValues(readCustomFieldValues(b.getCustomFieldValuesJson()))
                .createdAt(b.getCreatedAt())
                .build();
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> readCustomFieldValues(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Map.class);
        } catch (Exception e) {
            log.warn("Parsing booking custom fields failed: {}", e.getMessage());
            return null;
        }
    }
}
