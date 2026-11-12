package vacademy.io.notification_service.features.announcements.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.notification_service.features.announcements.enums.MediumType;
import vacademy.io.notification_service.features.announcements.enums.MessageStatus;
import vacademy.io.notification_service.features.announcements.enums.ModeType;

import java.time.LocalDateTime;

/**
 * One recipient's delivery + interaction state for an announcement.
 * Used by the admin dashboard to list who saw / dismissed an announcement.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AnnouncementRecipientInteractionResponse {
    private String recipientMessageId;
    private String userId;
    private String userName;
    private ModeType modeType;
    private MediumType mediumType;
    private MessageStatus status;
    private String errorMessage;
    private LocalDateTime deliveredAt;
    private LocalDateTime readAt;
    private LocalDateTime dismissedAt;

    // Email rows only: the address used and what SES reported for that email.
    private String email;
    /** FAILED, BOUNCED, REJECTED, COMPLAINED, CLICKED, OPENED, DELIVERED or SENT (no event yet). */
    private String emailStatus;
    private LocalDateTime emailOpenedAt;
    private LocalDateTime emailClickedAt;
}
