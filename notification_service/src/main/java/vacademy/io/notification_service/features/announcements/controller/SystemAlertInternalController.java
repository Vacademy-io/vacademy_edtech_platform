package vacademy.io.notification_service.features.announcements.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.notification_service.features.announcements.repository.AnnouncementRepository;

/**
 * Service-to-service operations on system alerts.
 *
 * Sits under "/notification-service/internal/**" — the convention for callers
 * that are other services rather than a browser — and deliberately NOT under
 * "/user-messages", which is the surface the bell itself reads.
 */
@RestController
@RequestMapping("/notification-service/internal/v1/system-alerts")
@RequiredArgsConstructor
public class SystemAlertInternalController {

    private final AnnouncementRepository announcementRepository;

    /**
     * Switch off the still-active alerts raised about one entity.
     *
     * The lead-assignment alert is not dismissible by hand — it is meant to sit
     * on the counsellor's bell until they work the lead — so this is how it
     * comes down. admin-core calls it when a timeline event lands on that lead.
     *
     * @return how many alert rows were switched off
     */
    @PutMapping("/deactivate-by-entity")
    public ResponseEntity<Integer> deactivateByEntity(
            @RequestParam String instituteId,
            @RequestParam String entity,
            @RequestParam String entityId) {
        if (instituteId == null || instituteId.isBlank()
                || entity == null || entity.isBlank()
                || entityId == null || entityId.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(
                announcementRepository.deactivateSystemAlertsForEntity(instituteId, entity, entityId));
    }
}
