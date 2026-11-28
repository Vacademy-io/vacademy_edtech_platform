package vacademy.io.notification_service.features.announcements.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import vacademy.io.notification_service.features.announcements.security.InternalClientGuard;
import vacademy.io.notification_service.features.announcements.service.AnnouncementService;
import vacademy.io.notification_service.features.announcements.service.AnnouncementRecoveryService;

import java.util.List;
import java.util.Map;

/**
 * Service-to-service announcement endpoints (other services raise bell alerts through
 * {@code /multiple}). Every call must carry the service's clientName + Signature headers.
 */
@RestController
@RequestMapping("/notification-service/v1/announcements/admin")
@RequiredArgsConstructor
@Slf4j
@Validated
public class AnnouncementInternalController {

    @Autowired
    private AnnouncementService announcementService;
    
    @Autowired
    private AnnouncementRecoveryService recoveryService;

    @Autowired
    private InternalClientGuard internalClientGuard;

    @PostMapping("/multiple")
    public ResponseEntity<String> createAnnouncements(
            @RequestHeader(value = "clientName", required = false) String clientName,
            @RequestHeader(value = "Signature", required = false) String signature,
            @Valid @RequestBody List<CreateAnnouncementRequest> requests) {
        internalClientGuard.requireInternalClient(clientName, signature);

        for(CreateAnnouncementRequest request:requests){
            try {
                announcementService.createAnnouncement(request);
            } catch (Exception e) {
                log.error("Error creating announcement", e);
            }
        }
        return ResponseEntity.ok("");
    }
    
    /**
     * Restart announcement delivery
     * Useful for recovering from server crashes or stuck deliveries
     * 
     * This endpoint is async - returns immediately while delivery happens in background
     * 
     * @param announcementId The announcement to restart
     * @return Recovery status with pending/delivered/failed message counts
     */
    @PostMapping("/{announcementId}/restart")
    public ResponseEntity<Map<String, Object>> restartAnnouncement(
            @RequestHeader(value = "clientName", required = false) String clientName,
            @RequestHeader(value = "Signature", required = false) String signature,
            @PathVariable String announcementId) {
        internalClientGuard.requireInternalClient(clientName, signature);
        log.info("=== RESTART ENDPOINT CALLED ===");
        log.info("Received request to restart announcement: {}", announcementId);
        log.info("Request path: /notification-service/v1/announcements/admin/{}/restart", announcementId);
        
        try {
            // Get current status first
            Map<String, Object> status = recoveryService.getRecoveryStatus(announcementId);
            
            // Check if restart is needed
            Boolean restartNeeded = (Boolean) status.get("restartNeeded");
            if (restartNeeded != null && !restartNeeded) {
                status.put("message", "No restart needed - delivery is complete");
                return ResponseEntity.ok(status);
            }
            
            // Trigger async restart
            recoveryService.restartAnnouncement(announcementId);
            
            status.put("restartTriggered", true);
            status.put("message", "Announcement restart initiated in background");
            
            return ResponseEntity.ok(status);
            
        } catch (Exception e) {
            log.error("Error restarting announcement: {}", announcementId, e);
            return ResponseEntity.badRequest().body(Map.of(
                "error", e.getMessage(),
                "announcementId", announcementId
            ));
        }
    }
    
    /**
     * Get recovery status for an announcement
     * Shows counts of messages in different states (pending, delivered, failed, stuck)
     * 
     * @param announcementId The announcement to check
     * @return Status breakdown with message counts and progress
     */
    @GetMapping("/{announcementId}/recovery-status")
    public ResponseEntity<Map<String, Object>> getRecoveryStatus(
            @RequestHeader(value = "clientName", required = false) String clientName,
            @RequestHeader(value = "Signature", required = false) String signature,
            @PathVariable String announcementId) {
        internalClientGuard.requireInternalClient(clientName, signature);
        log.info("=== RECOVERY STATUS ENDPOINT CALLED ===");
        log.info("Received request to get recovery status for announcement: {}", announcementId);
        log.info("Request path: /notification-service/v1/announcements/admin/{}/recovery-status", announcementId);
        
        try {
            Map<String, Object> status = recoveryService.getRecoveryStatus(announcementId);
            return ResponseEntity.ok(status);
        } catch (Exception e) {
            log.error("Error getting recovery status for announcement: {}", announcementId, e);
            return ResponseEntity.badRequest().body(Map.of(
                "error", e.getMessage(),
                "announcementId", announcementId
            ));
        }
    }
}
