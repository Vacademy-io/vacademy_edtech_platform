package vacademy.io.notification_service.features.hub.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.notification_service.features.hub.dto.HubEmailEventListDTO;
import vacademy.io.notification_service.features.hub.dto.HubOverviewDTO;
import vacademy.io.notification_service.features.hub.dto.HubRecentItemDTO;
import vacademy.io.notification_service.features.hub.service.NotificationHubService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.config.InstituteStaffAccess;

import java.util.List;

/**
 * Notification Hub aggregates stats + recent incoming activity for the admin dashboard.
 * Email + WhatsApp counts are scoped by the institute's configured channels.
 */
@Slf4j
@RestController
@RequestMapping("/notification-service/v1/hub")
@RequiredArgsConstructor
public class NotificationHubController {

    private final NotificationHubService hubService;

    @GetMapping("/overview")
    public ResponseEntity<HubOverviewDTO> getOverview(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "7") int windowDays,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireStaff(user, clientId, instituteId);
        int clamped = Math.max(1, Math.min(windowDays, 90));
        return ResponseEntity.ok(hubService.getOverview(instituteId, clamped));
    }

    /**
     * Drill-down behind an overview email stat tile — the individual emails that were
     * delivered / opened / clicked / bounced / complained within the window.
     */
    @GetMapping("/emails")
    public ResponseEntity<HubEmailEventListDTO> getEmailEvents(
            @RequestParam String instituteId,
            @RequestParam String eventType,
            @RequestParam(defaultValue = "7") int windowDays,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireStaff(user, clientId, instituteId);
        int clampedWindow = Math.max(1, Math.min(windowDays, 90));
        int clampedPage = Math.max(0, page);
        int clampedSize = Math.max(1, Math.min(size, 100));
        return ResponseEntity.ok(
                hubService.getEmailEvents(instituteId, clampedWindow, eventType, clampedPage, clampedSize));
    }

    @GetMapping("/recent")
    public ResponseEntity<List<HubRecentItemDTO>> getRecent(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(defaultValue = "0") int offset,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(hubService.getRecentIncoming(instituteId, limit, offset));
    }
}
