package vacademy.io.notification_service.features.communication_timeline.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxTemplateButtonDTO;
import vacademy.io.notification_service.features.chatbot_flow.dto.MessageOriginDTO;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UnifiedCommunicationDTO {

    private String id;

    /**
     * Channel type: EMAIL, WHATSAPP, PUSH, SMS
     */
    private String channel;

    /**
     * Direction: OUTBOUND or INBOUND
     */
    private String direction;

    /**
     * Email subject, WA template name, or push notification title
     */
    private String title;

    /**
     * Outbound email subject, read back from the send's message_payload. Null for every other
     * channel, and for email rows written before the subject was stored there — {@link #title}
     * stays the display fallback. Kept separate from title because a resend has to reuse the
     * exact subject line that went out, not a heading scraped out of the rendered HTML.
     */
    private String subject;

    /**
     * Truncated preview of message body (first 150 chars)
     */
    private String bodyPreview;

    /**
     * Full message body (for expanded view)
     */
    private String fullBody;

    /**
     * WhatsApp template name if applicable
     */
    private String templateName;

    /**
     * WhatsApp template header type: NONE, TEXT, IMAGE, VIDEO, DOCUMENT
     */
    private String headerType;

    /**
     * Actual media URL for an IMAGE/VIDEO/DOCUMENT header, so the UI can display the attachment
     */
    private String headerMediaUrl;

    /**
     * WhatsApp template buttons (links, quick replies), as WhatsApp draws them under the message
     */
    private List<InboxTemplateButtonDTO> buttons;

    /**
     * Who sent this WhatsApp message — a workflow or a chatbot flow, with its name; null when unknown
     */
    private MessageOriginDTO origin;

    /**
     * Current status: PENDING, SENT, DELIVERED, READ, FAILED, BOUNCED
     */
    private String status;

    /**
     * Chronological list of status changes
     */
    private List<StatusEvent> statusTimeline;

    /**
     * Sender info (email address, phone number, or system name)
     */
    private String senderInfo;

    /**
     * Recipient info (email address, phone number)
     */
    private String recipientInfo;

    /**
     * When the message was sent or received
     */
    private Instant timestamp;

    /**
     * Source system (e.g., announcement-service, chatbot-flow, otp, email-service)
     */
    private String source;

    /**
     * Source entity ID (e.g., announcement ID)
     */
    private String sourceId;

    /**
     * Channel-specific metadata (parsed from messagePayload)
     */
    private Map<String, Object> metadata;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class StatusEvent {
        private String status;
        private Instant timestamp;
        private String details;
    }
}
