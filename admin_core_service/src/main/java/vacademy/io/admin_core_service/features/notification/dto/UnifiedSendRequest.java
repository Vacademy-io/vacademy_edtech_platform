package vacademy.io.admin_core_service.features.notification.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Mirrors notification-service's UnifiedSendRequest.
 * Single DTO for sending WhatsApp, Email, Push, or System Alert.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UnifiedSendRequest {

    private String instituteId;
    private String channel; // WHATSAPP, EMAIL, PUSH, SYSTEM_ALERT
    private String templateName;
    private String languageCode;
    private List<Recipient> recipients;
    private SendOptions options;

    /**
     * When TRUE, notification-service queues the send to its durable batch
     * processor instead of sending inline. Required for multi-recipient sends:
     * the inline loop can outlive InternalClientUtils' 30s read timeout, which
     * surfaces as a 510 here even though delivery continues on the other side.
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
        private Map<String, String> variables;
        private List<Attachment> attachments;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Attachment {
        private String filename;
        private String contentBase64;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SendOptions {
        private String emailSubject;
        private String emailBody;
        private String emailType;
        @JsonProperty("fromEmail")
        private String fromEmail;
        @JsonProperty("fromName")
        private String fromName;
        private String headerType;
        private String headerUrl;
        private Map<String, String> buttonUrlParams;
        private String pushTitle;
        private String pushBody;
        private Map<String, String> pushData;
        private Integer rateLimitPerSecond;

        /**
         * Explicit copy recipients for EMAIL sends. Null/empty means "use the institute's
         * configured emailCc block", which notification-service resolves from {@link #source}.
         */
        private List<String> cc;

        /** "CC" (visible) or "BCC" (hidden). Defaults to BCC when unset. */
        private String ccMode;

        private String source;
        private String sourceId;

        /**
         * Who is sending (see {@link MessageOrigin}) — shown in the WhatsApp Inbox and timeline.
         * Left off the JSON when unset, so every other send's request body is unchanged.
         */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String originType;
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String originId;
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private String originName;
    }
}
