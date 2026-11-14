package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.sql.Timestamp;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreateLeadFollowupRequest {
    private String audienceResponseId;
    private String instituteId;
    private Timestamp scheduleTime;
    private String content;
    /** Optional, and only offered when the institute has turned the fields on. */
    private String studentResponse;
    private String followUpMode;
    private String nextAction;
    private String interestLevel;
}
