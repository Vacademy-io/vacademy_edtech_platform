package vacademy.io.auth_service.feature.notification.dto.unified;

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
    private String channel;
    private String templateName;
    private String languageCode;
    private List<Recipient> recipients;
    private SendOptions options;

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
        /**
         * Email billing class: FREE (login codes, password reset, login details), ESSENTIAL
         * (receipts, invoices) or BILLABLE. Null lets notification-service decide.
         */
        private String billingClass;
        private String source;
        private String sourceId;
    }
}
