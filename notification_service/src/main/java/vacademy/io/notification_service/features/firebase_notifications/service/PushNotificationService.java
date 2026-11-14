package vacademy.io.notification_service.features.firebase_notifications.service;


import com.google.firebase.messaging.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.firebase_notifications.repository.FcmTokenRepository;
import vacademy.io.notification_service.features.firebase_notifications.entity.FcmToken;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class PushNotificationService {

    private static final Logger logger = LoggerFactory.getLogger(PushNotificationService.class);

    @Autowired
    private MultiTenantFirebaseManager multiTenantFirebaseManager;

    @Autowired
    private FcmTokenRepository fcmTokenRepository;

    /** Tokens that belong to a Firebase project other than their institute's (learned on a fallback send). */
    private final Map<String, FirebaseMessaging> tokenProject = new ConcurrentHashMap<>();
    private static final int TOKEN_PROJECT_CACHE_MAX = 50_000;
    /** Tokens no configured project accepted: skip the cross-project retry for them until this time (ms). */
    private final Map<String, Long> fallbackMissUntil = new ConcurrentHashMap<>();
    private static final long FALLBACK_MISS_TTL_MS = 60 * 60 * 1000L;

    /**
     * Send push notification to a specific user
     */
    public void sendNotificationToUser(String instituteId, String userId, String title, String body, Map<String, String> data) {
        var messagingOpt = multiTenantFirebaseManager.getMessagingForInstitute(instituteId);
        if (messagingOpt.isEmpty()) {
            logger.warn("Firebase is not initialized for institute {}. Cannot send push notification to user: {}", instituteId, userId);
            return;
        }

        List<FcmToken> userTokens;
        if (instituteId != null && !instituteId.isBlank()) {
            userTokens = fcmTokenRepository.findByUserIdAndInstituteIdAndIsActiveTrue(userId, instituteId);
            if (userTokens.isEmpty()) {
                userTokens = fcmTokenRepository.findByUserIdAndIsActiveTrue(userId);
            }
        } else {
            userTokens = fcmTokenRepository.findByUserIdAndIsActiveTrue(userId);
        }
        
        if (userTokens.isEmpty()) {
            logger.warn("No active FCM tokens found for user: {}", userId);
            return;
        }

        for (FcmToken fcmToken : userTokens) {
            // Cross-project retry only for devices registered under this institute. The any-institute fallback
            // above can return a token of another institute's app; retrying it on that app's project would
            // show this institute's message inside another institute's branded app.
            boolean sameInstitute = instituteId != null && instituteId.equals(fcmToken.getInstituteId());
            sendToToken(messagingOpt.get(), fcmToken.getToken(), title, body, data, sameInstitute);
        }
    }

    /**
     * Send push notification to a specific FCM token
     */
    public void sendNotificationToToken(FirebaseMessaging firebaseMessaging, String fcmToken, String title, String body, Map<String, String> data) {
        sendToToken(firebaseMessaging, fcmToken, title, body, data, true);
    }

    /**
     * @param allowOtherProjects whether a token rejected as another project's may be retried on (and remembered
     *                           for) the other configured Firebase projects.
     */
    private void sendToToken(FirebaseMessaging firebaseMessaging, String fcmToken, String title, String body,
                             Map<String, String> data, boolean allowOtherProjects) {
        // A token remembered as belonging to another project goes straight there.
        FirebaseMessaging target = allowOtherProjects ? tokenProject.getOrDefault(fcmToken, firebaseMessaging) : firebaseMessaging;
        Message message = null;
        try {
            Message.Builder messageBuilder = Message.builder()
                .setToken(fcmToken)
                .setNotification(Notification.builder()
                    .setTitle(title)
                    .setBody(body)
                    .build());

            // Add custom data if provided
            if (data != null && !data.isEmpty()) {
                messageBuilder.putAllData(data);
            }

            // NOTE: we intentionally do NOT set a hardcoded WebpushFcmOptions link. This service is
            // multi-tenant (many frontends/origins) so a server-side absolute URL is wrong and a
            // fixed placeholder broke click-through entirely. The notification carries `data`
            // (type/action/conversationId/...) and the client (service worker / push-tap handler)
            // routes the click — see frontend push-notification handling.

            message = messageBuilder.build();
            String response = target.send(message);

            logger.debug("Successfully sent message to token {}: {}", maskToken(fcmToken), response);

        } catch (FirebaseMessagingException e) {
            if (allowOtherProjects && isOtherProjectsToken(e) && sendViaOtherProject(target, fcmToken, message)) {
                return;
            }
            if (target != firebaseMessaging) {
                tokenProject.remove(fcmToken); // remembered project no longer takes it — re-learn next time
            }
            logger.error("Failed to send notification to token {}: {}", maskToken(fcmToken), e.getMessage());

            // If the token is no longer valid, deactivate it so we stop pushing to it. Use the
            // FCM-specific MessagingErrorCode enum — e.getErrorCode() returns the generic platform
            // ErrorCode (no UNREGISTERED value), so the old String comparison was always false and
            // dead tokens were never cleaned up.
            MessagingErrorCode code = e.getMessagingErrorCode();
            if (code == MessagingErrorCode.UNREGISTERED || code == MessagingErrorCode.INVALID_ARGUMENT) {
                fcmTokenRepository.deactivateTokenByToken(fcmToken);
                logger.info("Deactivated invalid FCM token: {}", maskToken(fcmToken));
            }
        } catch (Exception e) {
            // Never let one bad token (or a null/short token) abort the rest of a bulk send.
            logger.error("Unexpected error sending notification to token {}: {}", maskToken(fcmToken), e.getMessage());
        }
    }

    /**
     * FCM rejects a token registered under a different Firebase project with SENDER_ID_MISMATCH (HTTP 403).
     * That's not a dead token — it's someone else's sender: e.g. a white-label institute whose Android app is
     * on its own project while its web users are on the shared "vacademy-app" project, but the institute has a
     * single key configured. Only that code triggers the retry: a bare PERMISSION_DENIED (e.g. a key without
     * FCM rights) would otherwise multiply every send across all projects.
     */
    static boolean isOtherProjectsToken(FirebaseMessagingException e) {
        return e.getMessagingErrorCode() == MessagingErrorCode.SENDER_ID_MISMATCH;
    }

    /**
     * Retry via every other configured Firebase project; remember the one that accepts the token. Never
     * deactivates the token based on these attempts — the primary project's verdict already covered that.
     */
    private boolean sendViaOtherProject(FirebaseMessaging rejectedBy, String fcmToken, Message message) {
        if (message == null) {
            return false;
        }
        Long missUntil = fallbackMissUntil.get(fcmToken);
        if (missUntil != null && missUntil > System.currentTimeMillis()) {
            return false; // no configured project accepted this token recently
        }
        List<FirebaseMessaging> others = multiTenantFirebaseManager.getOtherMessaging(rejectedBy);
        for (FirebaseMessaging other : others) {
            try {
                other.send(message);
                if (tokenProject.size() >= TOKEN_PROJECT_CACHE_MAX) {
                    tokenProject.clear(); // crude bound; entries are cheap to re-learn
                }
                tokenProject.put(fcmToken, other);
                fallbackMissUntil.remove(fcmToken);
                logger.info("Delivered to token {} via fallback Firebase project", maskToken(fcmToken));
                return true;
            } catch (FirebaseMessagingException fe) {
                logger.debug("Fallback Firebase project rejected token {}: {}", maskToken(fcmToken), fe.getMessage());
            } catch (Exception ex) {
                logger.debug("Fallback send failed for token {}: {}", maskToken(fcmToken), ex.getMessage());
            }
        }
        if (!others.isEmpty()) { // remember only a real miss, not "no other project configured yet"
            if (fallbackMissUntil.size() >= TOKEN_PROJECT_CACHE_MAX) {
                fallbackMissUntil.clear();
            }
            fallbackMissUntil.put(fcmToken, System.currentTimeMillis() + FALLBACK_MISS_TTL_MS);
        }
        return false;
    }

    /** Mask an FCM token for logging without risking StringIndexOutOfBounds on short/null tokens. */
    private static String maskToken(String token) {
        if (token == null) return "null";
        return token.length() > 8 ? token.substring(0, 8) + "…" : "***";
    }

    /**
     * Send notification to multiple users
     */
    public void sendNotificationToUsers(String instituteId, List<String> userIds, String title, String body, Map<String, String> data) {
        if (userIds == null || userIds.isEmpty()) {
            return;
        }
        // Check once: an institute without Firebase would otherwise log one WARN per recipient (chat and
        // community fan-outs reach hundreds of users).
        if (multiTenantFirebaseManager.getMessagingForInstitute(instituteId).isEmpty()) {
            logger.warn("Firebase is not initialized for institute {}. Skipping push to {} user(s).", instituteId, userIds.size());
            return;
        }
        for (String userId : userIds) {
            sendNotificationToUser(instituteId, userId, title, body, data);
        }
    }

    /**
     * Send broadcast notification to all active users
     */
    public void sendBroadcastNotification(String instituteId, String title, String body, Map<String, String> data) {
        var messagingOpt = multiTenantFirebaseManager.getMessagingForInstitute(instituteId);
        if (messagingOpt.isEmpty()) {
            logger.warn("Firebase is not initialized for institute {}. Cannot send broadcast.", instituteId);
            return;
        }

        List<FcmToken> allTokens = (instituteId == null || instituteId.isBlank())
            ? fcmTokenRepository.findByIsActiveTrue()
            : fcmTokenRepository.findByInstituteIdAndIsActiveTrue(instituteId);

        for (FcmToken fcmToken : allTokens) {
            sendNotificationToToken(messagingOpt.get(), fcmToken.getToken(), title, body, data);
        }
    }

    /**
     * Send assignment notification
     */
    public void sendAssignmentNotification(String userId, String assignmentTitle, String assignmentId) {
        Map<String, String> data = new HashMap<>();
        data.put("type", "assignment");
        data.put("assignmentId", assignmentId);
        data.put("action", "view_assignment");

        sendNotificationToUser(
            null,
            userId,
            "📚 New Assignment",
            "New assignment: " + assignmentTitle,
            data
        );
    }

    /**
     * Send live class notification
     */
    public void sendLiveClassNotification(String userId, String className, String sessionId, int minutesUntilStart) {
        Map<String, String> data = new HashMap<>();
        data.put("type", "live_class");
        data.put("sessionId", sessionId);
        data.put("action", "join_class");

        String title = minutesUntilStart <= 5 ? "🔴 Live Class Starting Now!" : "📅 Live Class Reminder";
        String body = minutesUntilStart <= 5 ? 
            className + " is starting now!" : 
            className + " starts in " + minutesUntilStart + " minutes";

        sendNotificationToUser(null, userId, title, body, data);
    }

    /**
     * Send achievement notification
     */
    public void sendAchievementNotification(String userId, String achievementTitle, String points) {
        Map<String, String> data = new HashMap<>();
        data.put("type", "achievement");
        data.put("points", points);
        data.put("action", "view_achievements");

        sendNotificationToUser(
            null,
            userId,
            "🏆 Achievement Unlocked!",
            achievementTitle + " (+" + points + " points)",
            data
        );
    }

    /**
     * Send announcement notification
     */
    public void sendAnnouncementNotification(String instituteId, List<String> userIds, String title, String message, String announcementId) {
        Map<String, String> data = new HashMap<>();
        data.put("type", "announcement");
        data.put("announcementId", announcementId);
        data.put("action", "view_announcement");

        sendNotificationToUsers(instituteId, userIds, "📢 " + title, message, data);
    }
}