package vacademy.io.admin_core_service.features.live_session.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.live_session.dto.GetSessionDetailsBySessionIdResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.MarkAttendanceRequestDTO;
import vacademy.io.admin_core_service.features.live_session.entity.SessionGuestRegistration;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.manager.BbbMeetingManager;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionGuestRegistrationRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.service.GetSessionByIdService;
import vacademy.io.admin_core_service.features.live_session.service.LIveSessionAttendanceService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;


@RestController
@RequestMapping("/admin-core-service/live-session/guest")
@RequiredArgsConstructor
@Slf4j
public class GuestController {

    @Autowired
    private GetSessionByIdService getSessionByIdService;

    @Autowired
    private LIveSessionAttendanceService lIveSessionAttendanceService;

    @Autowired
    private BbbMeetingManager bbbMeetingManager;

    @Autowired
    private SessionScheduleRepository scheduleRepository;

    @Autowired
    private LiveSessionLogsRepository liveSessionLogsRepository;

    @Autowired
    private SessionGuestRegistrationRepository guestRegistrationRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.live_session.service.LiveSessionPaymentService liveSessionPaymentService;

    /**
     * Open schedule → session resolution. Lets a guest page that only knows the
     * scheduleId (embed / waiting-room deep links) find the parent session so it
     * can bounce an unidentified visitor to the public registration page — the
     * place that recovers identity (email/phone + OTP) — instead of dead-ending
     * on the paid-access 403. Returns only the id, no gated details.
     */
    @GetMapping("/session-id-by-schedule-id")
    ResponseEntity<Map<String, String>> getSessionIdByScheduleId(
            @RequestParam("scheduleId") String scheduleId) {
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));
        return ResponseEntity.ok(Map.of("sessionId", schedule.getSessionId()));
    }

    @GetMapping("/get-session-by-schedule-id")
    ResponseEntity<GetSessionDetailsBySessionIdResponseDTO> getSessionByScheduleIdForGuestUser(
            @RequestParam("scheduleId") String scheduleId,
            @RequestParam(value = "registrationId", required = false) String registrationId) {
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));
        ensurePaidAccess(schedule.getSessionId(), registrationId);
        return ResponseEntity.ok(getSessionByIdService.getSessionByScheduleIdForGuestUser(scheduleId));
    }

    @PostMapping("/mark-attendance")
    public ResponseEntity<String> markAttendanceForGuest(@RequestBody MarkAttendanceRequestDTO request ) {
        lIveSessionAttendanceService.markAttendanceForGuest(request);
        return ResponseEntity.ok("Attendance marked successfully.");
    }

    /**
     * GET /admin-core-service/live-session/guest/bbb-join
     * ?scheduleId=xxx&registrationId=yyy[&guestName=John]
     *
     * Public (no auth) BBB join for guest/public sessions.
     * The moderator (admin) must have started the meeting first.
     * Returns a personalized BBB join URL for the guest viewer.
     *
     * A registered guest joins under the name they typed on the registration
     * form, with the registration id as BBB userID — so the analytics callback
     * and the guest attendance report both land on one EXTERNAL_USER row.
     * guestName is only the fallback for a visitor with no registration.
     */
    @GetMapping("/bbb-join")
    public ResponseEntity<Map<String, String>> guestBbbJoin(
            @RequestParam String scheduleId,
            @RequestParam(defaultValue = "Guest") String guestName,
            @RequestParam(value = "registrationId", required = false) String registrationId) {

        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));
        ensurePaidAccess(schedule.getSessionId(), registrationId);

        String providerMeetingId = schedule.getProviderMeetingId();

        // Guest cannot create meetings — moderator (admin) must start the meeting first
        if (providerMeetingId == null || providerMeetingId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Meeting has not started yet. Please wait for the host to start the class."));
        }

        // Check if meeting is running — guests can only join running meetings
        boolean isRunning = bbbMeetingManager.isMeetingRunning(providerMeetingId, null);
        if (!isRunning) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Meeting has not started yet or has ended",
                    "meetingId", providerMeetingId));
        }

        Optional<SessionGuestRegistration> registration =
                findRegistration(schedule.getSessionId(), registrationId);
        String displayName = registration
                .flatMap(reg -> registrantName(reg.getId()))
                .orElse(guestName);
        // Unregistered visitor: anonymous one-off identity, as before.
        String userSourceType = registration.isPresent() ? "EXTERNAL_USER" : "GUEST";
        String guestId = registration.map(SessionGuestRegistration::getId)
                .orElseGet(() -> "guest-" + UUID.randomUUID().toString().substring(0, 8));

        String joinUrl = bbbMeetingManager.buildJoinUrlForUser(
                providerMeetingId, displayName, guestId, "VIEWER", null);

        markGuestBbbAttendance(schedule.getSessionId(), scheduleId, userSourceType, guestId,
                displayName, providerMeetingId);

        return ResponseEntity.ok(Map.of(
                "joinUrl", joinUrl,
                "meetingId", providerMeetingId));
    }

    /**
     * Paid-session gate for the open guest endpoints: when the session carries a
     * fee, the caller must present the registration id it received on
     * register-and-pay, and that registration must be PAID. Free sessions are
     * unaffected (registrationId stays optional for backward compatibility).
     */
    private void ensurePaidAccess(String sessionId, String registrationId) {
        if (!liveSessionPaymentService.isRegistrationCleared(sessionId, registrationId)) {
            throw new VacademyException(org.springframework.http.HttpStatus.FORBIDDEN,
                    "This session requires payment. Please complete your payment to join");
        }
    }

    /**
     * The registration behind registrationId, only if it belongs to this session.
     * Fail-soft: a lookup error degrades to the anonymous identity rather than
     * blocking the join — the meeting is running and the learner is waiting.
     */
    private Optional<SessionGuestRegistration> findRegistration(String sessionId, String registrationId) {
        if (registrationId == null || registrationId.isBlank()) {
            return Optional.empty();
        }
        try {
            return guestRegistrationRepository.findById(registrationId)
                    .filter(reg -> sessionId.equals(reg.getSessionId()));
        } catch (Exception e) {
            log.warn("[BBB Guest] Registration lookup failed for {}: {}", registrationId, e.getMessage());
            return Optional.empty();
        }
    }

    /** Trimmed registration-form name, empty when absent/blank or if the lookup fails. */
    private Optional<String> registrantName(String registrationId) {
        try {
            return guestRegistrationRepository.findRegistrantNameByRegistrationId(registrationId)
                    .map(String::trim)
                    .filter(name -> !name.isEmpty());
        } catch (Exception e) {
            log.warn("[BBB Guest] Name lookup failed for registration {}: {}", registrationId, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Upsert rather than save: a registered guest may already hold an
     * EXTERNAL_USER row for this schedule from the waiting-room mark, and the
     * V415 unique index would reject a second insert for the same source id.
     */
    private void markGuestBbbAttendance(String sessionId, String scheduleId, String userSourceType,
                                         String guestId, String guestName, String providerMeetingId) {
        try {
            liveSessionLogsRepository.upsertBbbJoinAttendance(
                    UUID.randomUUID().toString(),
                    sessionId,
                    scheduleId,
                    userSourceType,
                    guestId,
                    guestName + " | role=VIEWER | guest=true",
                    java.time.Instant.now().toString(),
                    providerMeetingId);
        } catch (Exception e) {
            log.warn("[BBB Guest] Failed to mark attendance: {}", e.getMessage());
        }
    }
}
