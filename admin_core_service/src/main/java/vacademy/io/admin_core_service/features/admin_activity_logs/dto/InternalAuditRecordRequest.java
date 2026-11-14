package vacademy.io.admin_core_service.features.admin_activity_logs.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One admin action performed in ANOTHER service (assessment_service today),
 * to be written into admin_activity_log so the Activity Logs page shows it
 * next to the actions admin_core audits itself. The sender is trusted to
 * supply the actor: it authenticated the admin's JWT, admin_core never saw
 * that request.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class InternalAuditRecordRequest {
    private String instituteId;
    private String actorId;
    private String actorName;
    private String actorEmail;
    /** e.g. ASSESSMENT */
    private String entityType;
    private String entityId;
    /** e.g. CREATE / UPDATE / DELETE / PUBLISH */
    private String action;
    private String httpMethod;
    private String endpoint;
    /** Sentence for the log row, e.g. "created assessment Class X Science". */
    private String description;
    /** Arbitrary JSON: what was sent (already redacted by the sender). */
    private JsonNode requestPayload;
    private JsonNode beforePayload;
    private String ipAddress;
    private String userAgent;
    private Integer responseStatus;
}
