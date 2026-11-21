package vacademy.io.notification_service.features.firebase_notifications.controller;


import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;
import vacademy.io.notification_service.features.firebase_notifications.repository.FcmTokenRepository;
import vacademy.io.notification_service.features.firebase_notifications.entity.FcmToken;
import vacademy.io.notification_service.features.firebase_notifications.dto.FcmTokenRequest;
import vacademy.io.notification_service.features.firebase_notifications.dto.FcmNotificationRequest;
import vacademy.io.notification_service.features.firebase_notifications.dto.BulkPushRequest;
import vacademy.io.notification_service.features.firebase_notifications.dto.SystemAlertRequest;
import vacademy.io.notification_service.features.announcements.service.AnnouncementEventService;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.enums.ModeType;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;



@Slf4j
@RestController
@RequestMapping("/notification-service/push-notifications")
@CrossOrigin(origins = "*")
public class PushNotificationController {

    @Autowired
    private PushNotificationService pushNotificationService;

    @Autowired
    private FcmTokenRepository fcmTokenRepository;

    @Autowired
    private AnnouncementEventService announcementEventService;

    /**
     * Register FCM token for a user.
     *
     * The learner app registers without a token, so a signed-out call is still accepted. When
     * the caller is signed in, the token can only be registered for that same user.
     */
    @PostMapping("/register")
    public ResponseEntity<Map<String, Object>> registerToken(@AuthenticationPrincipal CustomUserDetails user,
                                                             @RequestBody FcmTokenRequest request) {
        Map<String, Object> response = new HashMap<>();

        if (user == null) {
            log.info("push_register_anonymous platform={} institute={}",
                    request.getPlatform(), request.getInstituteId());
        } else if (user.getUserId() == null || !user.getUserId().equals(request.getUserId())) {
            response.put("success", false);
            response.put("message", "A signed-in user can only register a device for themselves");
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
        }

        try {
            // Check if token already exists for this user/device
            Optional<FcmToken> existingToken = fcmTokenRepository
                .findByUserIdAndDeviceIdAndIsActiveTrue(request.getUserId(), request.getDeviceId());

            if (existingToken.isPresent()) {
                // Update existing token
                FcmToken token = existingToken.get();
                token.setToken(request.getToken());
                token.setPlatform(request.getPlatform());
                token.setInstituteId(request.getInstituteId());
                fcmTokenRepository.save(token);
                
                response.put("success", true);
                response.put("message", "FCM token updated successfully");
                response.put("tokenId", token.getId());
            } else {
                // Create new token
                FcmToken newToken = new FcmToken(
                    request.getInstituteId(),
                    request.getUserId(),
                    request.getToken(),
                    request.getPlatform(),
                    request.getDeviceId()
                );
                
                FcmToken savedToken = fcmTokenRepository.save(newToken);
                
                response.put("success", true);
                response.put("message", "FCM token registered successfully");
                response.put("tokenId", savedToken.getId());
            }

            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "Failed to register FCM token: " + e.getMessage());
            return ResponseEntity.badRequest().body(response);
        }
    }

    /**
     * Send test notification
     */
    @PostMapping("/send-test")
    public ResponseEntity<Map<String, Object>> sendTestNotification(@AuthenticationPrincipal CustomUserDetails user,
                                                                    @RequestBody FcmNotificationRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        Map<String, Object> response = new HashMap<>();
        
        try {
            Map<String, String> data = new HashMap<>();
            data.put("type", "test");
            data.put("timestamp", String.valueOf(System.currentTimeMillis()));

            pushNotificationService.sendNotificationToUser(
                request.getInstituteId(),
                request.getUserId(),
                request.getTitle(),
                request.getBody(),
                data
            );

            response.put("success", true);
            response.put("message", "Test notification sent successfully");
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "Failed to send test notification: " + e.getMessage());
            return ResponseEntity.badRequest().body(response);
        }
    }

    /**
     * Deactivate FCM token
     */
    @PostMapping("/deactivate")
    public ResponseEntity<Map<String, Object>> deactivateToken(@RequestParam String token) {
        Map<String, Object> response = new HashMap<>();

        try {
            fcmTokenRepository.deactivateTokenByToken(token);

            response.put("success", true);
            response.put("message", "FCM token deactivated successfully");
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "Failed to deactivate FCM token: " + e.getMessage());
            return ResponseEntity.badRequest().body(response);
        }
    }

    /**
     * Internal endpoint: Send push notification to multiple users
     */
    @PostMapping("/internal/send-to-users")
    public ResponseEntity<Map<String, Object>> sendToUsers(@RequestBody BulkPushRequest request) {
        Map<String, Object> response = new HashMap<>();

        try {
            for (String userId : request.getUserIds()) {
                pushNotificationService.sendNotificationToUser(
                        request.getInstituteId(),
                        userId,
                        request.getTitle(),
                        request.getBody(),
                        request.getData() != null ? request.getData() : Map.of()
                );
            }

            response.put("success", true);
            response.put("message", "Push notifications sent to " + request.getUserIds().size() + " users");
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "Failed to send push notifications: " + e.getMessage());
            return ResponseEntity.badRequest().body(response);
        }
    }

    /**
     * Internal endpoint: Send system alert (SSE) to multiple users
     */
    @PostMapping("/internal/send-system-alert")
    public ResponseEntity<Map<String, Object>> sendSystemAlert(@RequestBody SystemAlertRequest request) {
        Map<String, Object> response = new HashMap<>();

        try {
            AnnouncementEvent event = AnnouncementEvent.builder()
                    .type(EventType.SYSTEM_ALERT)
                    .modeType(ModeType.SYSTEM_ALERT)
                    .instituteId(request.getInstituteId())
                    .data(Map.of("title", request.getTitle(), "body", request.getBody()))
                    .timestamp(LocalDateTime.now())
                    .priority("MEDIUM")
                    .persistent(true)
                    .eventId("system_alert_" + System.currentTimeMillis())
                    .build();

            announcementEventService.sendToUsers(request.getUserIds(), event);

            response.put("success", true);
            response.put("message", "System alert sent to " + request.getUserIds().size() + " users");
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "Failed to send system alert: " + e.getMessage());
            return ResponseEntity.badRequest().body(response);
        }
    }
}