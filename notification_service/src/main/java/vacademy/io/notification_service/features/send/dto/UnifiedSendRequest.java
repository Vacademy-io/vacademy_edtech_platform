package vacademy.io.notification_service.features.send.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UnifiedSendRequest {

    private String instituteId;

    /**
     * Channel: WHATSAPP, EMAIL, PUSH, SYSTEM_ALERT
     */
    private String channel;

    /**
     * For WhatsApp template messages or email template IDs
     */
    private String templateName;

    private String languageCode;

    private List<Recipient> recipients;

    private SendOptions options;

    /**
     * When TRUE, the send is queued to the durable batch processor regardless of
     * recipient count. Bulk callers (audience blasts, list bulk-actions) must set
     * this: a multi-recipient sync send loops one provider call per recipient and
     * can outlive the internal 30s HTTP read timeout, surfacing as a 510 to the
     * caller even though delivery continues server-side.
     */
    private Boolean forceAsync;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Recipient {
        private String phone;
        private String email;
        private String userId;
        private String name;

        /**
         * Named variables: {"name": "Shreyash", "payment_link": "https://..."}
         * For WhatsApp, the service maps these to positional params using the template definition.
         * For Email, these replace {{key}} placeholders directly.
         */
        private Map<String, String> variables;

        /**
         * Email attachments (base64-encoded). Each entry: filename → base64 content.
         * Only used for EMAIL channel. Ignored for WhatsApp/Push.
         */
        private List<Attachment> attachments;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Attachment {
        private String filename;
        private String contentBase64; // base64-encoded file content
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SendOptions {
        // Email options
        private String emailSubject;
        private String emailBody;
        private String emailType; // UTILITY_EMAIL, PROMOTIONAL_EMAIL, TRANSACTIONAL_EMAIL
        private String previewText; // Hidden preview text shown in inbox before opening
        @JsonProperty("fromEmail")
        private String fromEmail;
        @JsonProperty("fromName")
        private String fromName;

        // WhatsApp options
        private String headerType; // image, video, document
        private String headerUrl;
        private Map<String, String> buttonUrlParams; // {"0": "https://..."}

        // Push notification options
        private String pushTitle;
        private String pushBody;
        private Map<String, String> pushData;

        // Rate limiting (optional — for bulk sends like announcements)
        private Integer rateLimitPerSecond;

        /**
         * Explicit copy recipients for EMAIL sends. When null/empty the send falls back to the
         * institute's configured {@code emailCc} block, matched on {@link #source} — see
         * {@code EmailCcResolver}. Set this only to override the institute config for one send.
         * Ignored by WhatsApp/Push, which have no copy-recipient concept.
         */
        private List<String> cc;

        /**
         * "CC" (visible to the primary recipient) or "BCC" (hidden). Defaults to BCC when unset,
         * because copies are almost always internal staff who should not be exposed on a
         * learner-facing receipt. Only meaningful alongside {@link #cc}.
         */
        private String ccMode;

        // General
        private String source;  // caller identifier for logging
        private String sourceId;

        /**
         * Who is sending, for the WhatsApp Inbox and student timeline ("sent by workflow X"):
         * WORKFLOW + workflow id + workflow name. Stored on the log row's message_payload only —
         * notification_log.source / correlation_id are left exactly as before.
         */
        private String originType;
        private String originId;
        private String originName;
    }
}
