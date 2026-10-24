package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SendAudienceMessageRequestDTO {

    private String audienceId;
    private String instituteId;
    private String channel;           // WHATSAPP, EMAIL, PUSH, SYSTEM_ALERT

    // Template (for WA + optional email)
    private String templateName;
    private String languageCode;      // WA language code (default: en)

    // WhatsApp media header. A template whose header is IMAGE/VIDEO/DOCUMENT is rejected
    // outright by Meta unless the media is supplied on every send — the sample approved
    // with the template is NOT attached automatically.
    private String headerUrl;
    private String headerType;        // image | video | document

    // Email/Push direct content
    private String subject;           // email subject or push title
    private String body;              // email HTML body or push body
    private String emailType;         // UTILITY_EMAIL, PROMOTIONAL_EMAIL

    // Variable mapping: { "templateVarName": "system:full_name" | "custom:{fieldId}" }
    private Map<String, String> variableMapping;

    // Optional filters to narrow recipients
    private AudienceFilterConfig filters;

    // Explicit recipient subset: audience_response ids picked in the lead table.
    // Empty/null means "every active lead in this audience" (the original blast).
    private List<String> responseIds;

    // Who is sending
    private String createdBy;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AudienceFilterConfig {
        private String sourceType;
        private String submittedFrom;     // ISO date
        private String submittedTo;
        private Map<String, String> customFieldFilters; // fieldId -> value
    }
}
