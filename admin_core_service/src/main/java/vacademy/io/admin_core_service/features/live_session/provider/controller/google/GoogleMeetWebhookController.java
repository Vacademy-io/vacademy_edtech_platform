package vacademy.io.admin_core_service.features.live_session.provider.controller.google;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleRecordingService;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;

import java.util.List;
import java.util.Map;

/**
 * Receives Google Workspace Events API notifications for Meet, delivered as Cloud Pub/Sub PUSH
 * messages. On a {@code recording.v2.fileGenerated} / {@code conference.v2.ended} event it triggers
 * a recording sync for the affected space — a latency optimization over the hourly poll (which
 * remains the source of truth, so a missed/duplicate push never loses a recording).
 *
 * PUBLIC endpoint (in ApplicationSecurityConfig permitAll). Optional shared-secret via
 * {@code ?token=} (set {@code google.events.push-token} and append it to the Pub/Sub push URL).
 * Always returns 200 so Pub/Sub doesn't retry-storm — the poll is the backstop.
 */
@RestController
@RequestMapping("/admin-core-service/live-sessions/provider/meeting")
@RequiredArgsConstructor
@Slf4j
// vendor-call-log: receives Google Workspace Events push notifications, makes no call
public class GoogleMeetWebhookController {

    private static final String SPACE_PREFIX = "//meet.googleapis.com/";

    private final SessionScheduleRepository scheduleRepository;
    private final GoogleRecordingService googleRecordingService;

    @Value("${google.events.push-token:}")
    private String pushToken;

    @PostMapping("/google-meet-callback")
    public ResponseEntity<Void> callback(
            @RequestParam(required = false) String token,
            @RequestBody(required = false) Map<String, Object> body) {

        // Optional shared-secret gate (Pub/Sub push URL carries ?token=…).
        if (pushToken != null && !pushToken.isBlank() && !pushToken.equals(token)) {
            log.warn("google.events.push rejected — bad/missing token");
            return ResponseEntity.ok().build();
        }
        if (body == null) {
            return ResponseEntity.ok().build();
        }

        try {
            Object messageObj = body.get("message");
            if (!(messageObj instanceof Map<?, ?> message)) {
                return ResponseEntity.ok().build();
            }
            Object attrsObj = message.get("attributes");
            String ceType = null;
            String ceSource = null;
            String ceSubject = null;
            if (attrsObj instanceof Map<?, ?> attrs) {
                ceType = stringVal(attrs.get("ce-type"));
                ceSource = stringVal(attrs.get("ce-source"));    // the subscription resource (log only)
                ceSubject = stringVal(attrs.get("ce-subject"));  // the affected resource: //meet.googleapis.com/spaces/{id}
            }

            // The affected space is in ce-subject; ce-source is the subscription, not the space.
            String spaceName = extractSpace(ceSubject);
            log.info("google.events.push type={} source={} space={}", ceType, ceSource, spaceName);
            if (spaceName != null) {
                List<SessionSchedule> schedules = scheduleRepository.findByProviderMeetingId(spaceName);
                for (SessionSchedule schedule : schedules) {
                    googleRecordingService.syncFromApi(schedule);
                }
            }
        } catch (Exception e) {
            // Never fail the ack — the hourly poll is the backstop.
            log.warn("google.events.push handling failed reason={}", e.getClass().getSimpleName());
        }
        return ResponseEntity.ok().build();
    }

    /** "//meet.googleapis.com/spaces/abc" → "spaces/abc". */
    private static String extractSpace(String ceSource) {
        if (ceSource == null) return null;
        String s = ceSource.startsWith(SPACE_PREFIX) ? ceSource.substring(SPACE_PREFIX.length()) : ceSource;
        return s.startsWith("spaces/") ? s : null;
    }

    private static String stringVal(Object o) {
        return o == null ? null : o.toString();
    }
}
