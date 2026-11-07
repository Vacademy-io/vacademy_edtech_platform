package vacademy.io.admin_core_service.features.live_activity.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/** One row of the history read (GET /events), and of the initial backfill. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class LiveActivityFeedItemDTO {
    private String eventId;
    private String instituteId;
    private long occurredAtEpochMillis;
    private String category;
    private String action;
    private String actorType;
    private String subjectName;
    private String subjectEmail;
    private String subjectMobile;
    private String subjectId;
    private String entityId;
    private String counsellorUserId;
    private String counsellorName;
    private Map<String, Object> payload;
}
