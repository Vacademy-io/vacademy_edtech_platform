package vacademy.io.notification_service.features.announcements.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.notification_service.features.announcements.dto.*;
import vacademy.io.notification_service.features.announcements.enums.ModeType;
import vacademy.io.notification_service.features.announcements.service.UserMessageService;

import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/notification-service/v1/user-messages")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class UserMessagesController {

    private final UserMessageService userMessageService;
    private static final long CACHE_MAX_AGE_MINUTES = 3L;

    private <T> ResponseEntity<T> cacheableOk(T body) {
        CacheControl cacheControl = CacheControl.maxAge(CACHE_MAX_AGE_MINUTES, TimeUnit.MINUTES).cachePublic();
        return ResponseEntity.ok()
                .cacheControl(cacheControl)
                .body(body);
    }

    /**
     * Get user messages by mode type (for UI components like bell icon, dashboard, etc.)
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<Page<UserMessagesResponse>> getUserMessages(
            @PathVariable String userId,
            @RequestParam(required = false) String modeType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        try {
            Pageable pageable = PageRequest.of(page, size);
            Page<UserMessagesResponse> messages;
            
            if (modeType != null) {
                ModeType mode = ModeType.valueOf(modeType.toUpperCase());
                messages = userMessageService.getUserMessagesByMode(userId, mode, pageable);
            } else {
                messages = userMessageService.getUserMessages(userId, pageable);
            }
            
            return cacheableOk(messages);
        } catch (Exception e) {
            log.error("Error getting user messages for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get unread messages count for user (for badge counts)
     */
    @GetMapping("/user/{userId}/unread-count")
    public ResponseEntity<Map<String, Long>> getUnreadCount(
            @PathVariable String userId,
            @RequestParam(required = false) String modeType) {
        
        try {
            Map<String, Long> counts;
            
            if (modeType != null) {
                ModeType mode = ModeType.valueOf(modeType.toUpperCase());
                Long count = userMessageService.getUnreadCountByMode(userId, mode);
                counts = Map.of(modeType.toLowerCase(), count);
            } else {
                counts = userMessageService.getUnreadCountsByMode(userId);
            }
            
            return cacheableOk(counts);
        } catch (Exception e) {
            log.error("Error getting unread count for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Mark message as read
     */
    @PostMapping("/interactions/read")
    public ResponseEntity<Map<String, String>> markAsRead(@Valid @RequestBody MessageInteractionRequest request) {
        try {
            userMessageService.markAsRead(request.getRecipientMessageId(), request.getUserId());
            return ResponseEntity.ok(Map.of("message", "Message marked as read"));
        } catch (Exception e) {
            log.error("Error marking message as read", e);
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Failed to mark message as read", "message", e.getMessage()));
        }
    }

    /**
     * Dismiss message (for dismissible notifications)
     */
    @PostMapping("/interactions/dismiss")
    public ResponseEntity<Map<String, String>> dismissMessage(@Valid @RequestBody MessageInteractionRequest request) {
        try {
            userMessageService.dismissMessage(request.getRecipientMessageId(), request.getUserId());
            return ResponseEntity.ok(Map.of("message", "Message dismissed"));
        } catch (Exception e) {
            log.error("Error dismissing message", e);
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Failed to dismiss message", "message", e.getMessage()));
        }
    }

    /**
     * Record message interaction (click, like, share, etc.)
     */
    @PostMapping("/interactions")
    public ResponseEntity<Map<String, String>> recordInteraction(@Valid @RequestBody MessageInteractionRequest request) {
        try {
            userMessageService.recordInteraction(request);
            return ResponseEntity.ok(Map.of("message", "Interaction recorded"));
        } catch (Exception e) {
            log.error("Error recording interaction", e);
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Failed to record interaction", "message", e.getMessage()));
        }
    }

    /**
     * Get messages for specific mode with mode-specific filtering
     */
    @GetMapping("/user/{userId}/resources")
    public ResponseEntity<Page<UserMessagesResponse>> getResourceMessages(
            @PathVariable String userId,
            @RequestParam(required = false) String folderName,
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        try {
            Pageable pageable = PageRequest.of(page, size);
            Page<UserMessagesResponse> messages = userMessageService
                    .getResourceMessages(userId, folderName, category, pageable);
            return cacheableOk(messages);
        } catch (Exception e) {
            log.error("Error getting resource messages for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get community messages with filtering
     */
    @GetMapping("/user/{userId}/community")
    public ResponseEntity<Page<UserMessagesResponse>> getCommunityMessages(
            @PathVariable String userId,
            @RequestParam(required = false) String communityType,
            @RequestParam(required = false) String tag,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        try {
            Pageable pageable = PageRequest.of(page, size);
            Page<UserMessagesResponse> messages = userMessageService
                    .getCommunityMessages(userId, communityType, tag, pageable);
            return cacheableOk(messages);
        } catch (Exception e) {
            log.error("Error getting community messages for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get dashboard pins for user
     */
    @GetMapping("/user/{userId}/dashboard-pins")
    public ResponseEntity<List<UserMessagesResponse>> getDashboardPins(@PathVariable String userId) {
        try {
            List<UserMessagesResponse> pins = userMessageService.getActiveDashboardPins(userId);
            return cacheableOk(pins);
        } catch (Exception e) {
            log.error("Error getting dashboard pins for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get active app overlays for user (full-screen announcements shown on app open).
     * no-store: the app checks this on every open and a stale cache would re-show
     * an overlay the user already dismissed.
     */
    @GetMapping("/user/{userId}/app-overlays")
    public ResponseEntity<List<UserMessagesResponse>> getAppOverlays(@PathVariable String userId) {
        try {
            List<UserMessagesResponse> overlays = userMessageService.getActiveAppOverlays(userId);
            return ResponseEntity.ok()
                    .cacheControl(CacheControl.noStore())
                    .body(overlays);
        } catch (Exception e) {
            log.error("Error getting app overlays for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get stream messages for package session
     */
    @GetMapping("/user/{userId}/streams/{packageSessionId}")
    public ResponseEntity<Page<UserMessagesResponse>> getStreamMessages(
            @PathVariable String userId,
            @PathVariable String packageSessionId,
            @RequestParam(required = false) String streamType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        try {
            Pageable pageable = PageRequest.of(page, size);
            Page<UserMessagesResponse> messages = userMessageService
                    .getStreamMessages(userId, packageSessionId, streamType, pageable);
            return cacheableOk(messages);
        } catch (Exception e) {
            log.error("Error getting stream messages for user: {} and package session: {}", userId, packageSessionId, e);
            return ResponseEntity.badRequest().build();
        }
    }


    /**
     * Get system alerts with priority filtering
     */
    @GetMapping("/user/{userId}/system-alerts")
    public ResponseEntity<Page<UserMessagesResponse>> getSystemAlerts(
            @PathVariable String userId,
            @RequestParam(required = false) String priority,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        try {
            Pageable pageable = PageRequest.of(page, size);
            Page<UserMessagesResponse> messages = userMessageService
                    .getSystemAlerts(userId, priority, pageable);
            return ResponseEntity.ok()
                    .cacheControl(CacheControl.noStore())
                    .body(messages);
        } catch (Exception e) {
            log.error("Error getting system alerts for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get direct messages for user
     */
    @GetMapping("/user/{userId}/direct-messages")
    public ResponseEntity<Page<UserMessagesResponse>> getDirectMessages(
            @PathVariable String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        try {
            Pageable pageable = PageRequest.of(page, size);
            Page<UserMessagesResponse> messages = userMessageService
                    .getDirectMessages(userId, pageable);
            return cacheableOk(messages);
        } catch (Exception e) {
            log.error("Error getting direct messages for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get all stream messages for user (without specific package session)
     */
    @GetMapping("/user/{userId}/streams")
    public ResponseEntity<Page<UserMessagesResponse>> getAllStreamMessages(
            @PathVariable String userId,
            @RequestParam(required = false) String streamType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        try {
            Pageable pageable = PageRequest.of(page, size);
            Page<UserMessagesResponse> messages = userMessageService
                    .getStreamMessages(userId, null, streamType, pageable);
            return cacheableOk(messages);
        } catch (Exception e) {
            log.error("Error getting all stream messages for user: {}", userId, e);
            return ResponseEntity.badRequest().build();
        }
    }
}