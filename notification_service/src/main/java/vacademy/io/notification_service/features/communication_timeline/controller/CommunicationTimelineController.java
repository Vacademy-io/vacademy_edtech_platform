package vacademy.io.notification_service.features.communication_timeline.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.notification_service.features.communication_timeline.dto.CommunicationTimelineRequest;
import vacademy.io.notification_service.features.communication_timeline.dto.UnifiedCommunicationDTO;
import vacademy.io.notification_service.features.communication_timeline.service.CommunicationTimelineService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.config.InstituteStaffAccess;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/notification-service/v1/communications")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class CommunicationTimelineController {

    private final CommunicationTimelineService communicationTimelineService;

    /**
     * Get unified communication timeline for a user.
     * Merges email tracking, WhatsApp messages (in+out), and push notifications.
     *
     * GET /notification-service/v1/communications/user/{userId}?page=0&size=20&channels=EMAIL,WHATSAPP&direction=ALL
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<Page<UnifiedCommunicationDTO>> getUserCommunications(
            @PathVariable String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) List<String> channels,
            @RequestParam(required = false, defaultValue = "ALL") String direction,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {

        // The user themselves, or staff of the institute.
        InstituteStaffAccess.requireSelfOrStaff(user, clientId, userId);

        try {
            log.info("Fetching communication timeline for userId: {}, page: {}, size: {}, channels: {}, direction: {}",
                    userId, page, size, channels, direction);

            CommunicationTimelineRequest request = CommunicationTimelineRequest.builder()
                    .userId(userId)
                    .page(page)
                    .size(size)
                    .channels(channels)
                    .direction(direction)
                    .fromDate(fromDate != null ? Instant.parse(fromDate) : null)
                    .toDate(toDate != null ? Instant.parse(toDate) : null)
                    .build();

            Page<UnifiedCommunicationDTO> response = communicationTimelineService.getUserCommunications(request);
            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            log.error("Invalid request for user {}: {}", userId, e.getMessage());
            return ResponseEntity.badRequest().build();
        } catch (Exception e) {
            log.error("Error fetching communication timeline for user {}: {}", userId, e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    /**
     * Get unified communication timeline queried by channel_id.
     * EMAIL logs are matched by the user's email address; WhatsApp logs by phone number.
     *
     * GET /notification-service/v1/communications/by-channel?email=&phone=&page=0&size=20&channels=EMAIL,WHATSAPP
     */
    @GetMapping("/by-channel")
    public ResponseEntity<Page<UnifiedCommunicationDTO>> getUserCommunicationsByChannel(
            @RequestParam(required = false) String email,
            @RequestParam(required = false) String phone,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) List<String> channels,
            @RequestParam(required = false, defaultValue = "ALL") String direction,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {

        // Staff of the institute (the admin dashboard's learner side view).
        InstituteStaffAccess.requireStaff(user, clientId);

        try {
            log.info("Fetching channel-based communication timeline: email={}, phone={}, page={}, size={}, channels={}",
                    email, phone, page, size, channels);

            CommunicationTimelineRequest request = CommunicationTimelineRequest.builder()
                    .email(email)
                    .phone(phone)
                    .page(page)
                    .size(size)
                    .channels(channels)
                    .direction(direction)
                    .fromDate(fromDate != null ? Instant.parse(fromDate) : null)
                    .toDate(toDate != null ? Instant.parse(toDate) : null)
                    .build();

            Page<UnifiedCommunicationDTO> response = communicationTimelineService.getUserCommunicationsByChannel(request);
            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            log.error("Invalid channel-based request: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        } catch (Exception e) {
            log.error("Error fetching channel-based communication timeline: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }
}
