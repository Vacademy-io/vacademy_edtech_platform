package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.sql.Timestamp;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UpdateLeadFollowupRequest {
    /** Open follow-ups only - a closed one keeps the time it was due. */
    private Timestamp scheduleTime;
    /** The rest stay editable after closing, so a counsellor can correct a note. */
    private String content;
    private String closerReason;
    private String interestLevel;
}
