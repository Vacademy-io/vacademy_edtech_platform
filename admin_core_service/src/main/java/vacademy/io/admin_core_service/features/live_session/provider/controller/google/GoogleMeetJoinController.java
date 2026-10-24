package vacademy.io.admin_core_service.features.live_session.provider.controller.google;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleJoinPayloadResponse;
import vacademy.io.admin_core_service.features.live_session.provider.manager.GoogleMeetManager;
import vacademy.io.admin_core_service.features.live_session.provider.security.JoinAuthorization;
import vacademy.io.admin_core_service.features.live_session.provider.security.LiveSessionJoinAuthorizer;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccountStore;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAttendanceService;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Resolves the Google Meet join URL for an authenticated learner/host and records attendance.
 *
 * Google Meet has no SDK to embed, so the learner dashboard's "Join Google Meet" launcher calls
 * this to (a) authorize the join (enrolment + institute isolation, role derived server-side), (b)
 * mark the learner PRESENT at this authenticated touchpoint — the primary attendance signal — and
 * (c) return the {@code meetingUri} to open. Mirrors {@code ZoomSdkController}'s join touchpoint
 * for a URL-join provider.
 */
@RestController
@RequestMapping("/admin-core-service/live-sessions/provider/meeting")
@RequiredArgsConstructor
@Slf4j
public class GoogleMeetJoinController {

    private final SessionScheduleRepository scheduleRepository;
    private final LiveSessionJoinAuthorizer joinAuthorizer;
    private final GoogleAttendanceService attendanceService;
    private final GoogleAccountStore googleAccountStore;
    private final UserRepository userRepository;
    private final GoogleMeetManager googleMeetManager;

    @GetMapping("/google-meet-join")
    public ResponseEntity<GoogleJoinPayloadResponse> join(
            @RequestParam String scheduleId,
            @RequestParam(required = false) String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {

        JoinAuthorization auth = joinAuthorizer.authorize(scheduleId, user, instituteId);

        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Schedule not found: " + scheduleId));

        if (schedule.getProviderMeetingId() == null || schedule.getProviderMeetingId().isBlank()
                || schedule.getCustomMeetingLink() == null || schedule.getCustomMeetingLink().isBlank()) {
            // 409: the session is valid, the Meet space just isn't provisioned yet (still
            // creating, or a prior attempt failed and the retry job will recreate it).
            throw new VacademyException(HttpStatus.CONFLICT,
                    "This Google Meet is still being set up. Please try again in a moment.");
        }

        String userName = resolveUserName(user);
        boolean host = auth.role().isHost();

        // Attendance at this authenticated touchpoint (learners only; hosts aren't counted).
        if (!host) {
            attendanceService.markPresent(schedule.getSessionId(), scheduleId,
                    user.getUserId(), userName, schedule.getProviderMeetingId());
        }

        GoogleAccount account = schedule.getProviderAccountId() == null ? null
                : googleAccountStore.findById(schedule.getProviderAccountId()).orElse(null);
        // The host should open Meet signed into the connected organizer account for auto-recording.
        String organizerEmail = account == null ? null : account.getOrganizerEmail();

        // A teacher/admin on their own Google account is only a participant in Meet; making them a
        // co-host here gives them host controls, like a BBB moderator join.
        String cohostEmail = null;
        if (host) {
            String email = resolveUserEmail(user);
            if (googleMeetManager.ensureCohost(account, schedule.getProviderMeetingId(), email)) {
                cohostEmail = email;
            }
        }

        log.info("google.meet.join scheduleId={} userId={} host={} cohost={}",
                scheduleId, user.getUserId(), host, cohostEmail != null);

        return ResponseEntity.ok(GoogleJoinPayloadResponse.builder()
                .joinUrl(schedule.getCustomMeetingLink())
                .userName(userName)
                .providerMeetingId(schedule.getProviderMeetingId())
                .host(host)
                .organizerEmail(organizerEmail)
                .cohostEmail(cohostEmail)
                .build());
    }

    /** Login email — JWT first, DB fallback. */
    private String resolveUserEmail(CustomUserDetails user) {
        if (user.getEmail() != null && !user.getEmail().isBlank()) {
            return user.getEmail();
        }
        try {
            return userRepository.findById(user.getUserId())
                    .map(u -> u.getEmail())
                    .filter(e -> e != null && !e.isBlank())
                    .orElse(null);
        } catch (Exception e) {
            log.warn("google.meet.join email lookup failed userId={}", user.getUserId());
            return null;
        }
    }

    /** Display name — JWT full name, DB fallback, then username. */
    private String resolveUserName(CustomUserDetails user) {
        if (user.getFullName() != null && !user.getFullName().isBlank()) {
            return user.getFullName();
        }
        try {
            var dbUser = userRepository.findById(user.getUserId());
            if (dbUser.isPresent() && dbUser.get().getFullName() != null
                    && !dbUser.get().getFullName().isBlank()) {
                return dbUser.get().getFullName();
            }
        } catch (Exception e) {
            log.warn("google.meet.join name lookup failed userId={}", user.getUserId());
        }
        return user.getUsername();
    }
}
