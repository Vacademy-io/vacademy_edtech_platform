package vacademy.io.admin_core_service.features.notification.constants;

public class NotificationConstant {

    /** Unified send endpoint — single API for WhatsApp, Email, Push, System Alert */
    public static final String UNIFIED_SEND = "/notification-service/internal/v1/send";

    /** Event-driven notification endpoint */
    public static final String NOTIFICATION_EVENT = "/notification-service/internal/v1/events";

    /**
     * Announcement batch-create endpoint. The unified send SYSTEM_ALERT channel only emits an FCM
     * push; to light up the recipient's bell we must create an Announcement with modeType=SYSTEM_ALERT
     * so a RecipientMessage row is persisted that the bell endpoint (
     * {@code /v1/user-messages/user/{userId}/system-alerts}) can read back.
     * This path is open for inter-service calls (see AnnouncementSecurityConfig).
     */
    public static final String ANNOUNCEMENT_MULTIPLE = "/notification-service/v1/announcements/admin/multiple";

    /** Service-to-service: switch off the system alerts raised about one entity. */
    public static final String SYSTEM_ALERT_DEACTIVATE_BY_ENTITY =
            "/notification-service/internal/v1/system-alerts/deactivate-by-entity";
}