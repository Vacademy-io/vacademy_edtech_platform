package vacademy.io.admin_core_service.features.admin_activity_logs.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.List;

/**
 * Filter set for a log read.
 *
 * <p>Actor, resource and activity are <em>lists</em>: the audit UI lets an admin
 * tick several people ("what did the three counsellors do today?") or several
 * resources at once, which one equality predicate cannot express. A single
 * value is just a one-element list, so the old single-value query params keep
 * working unchanged.
 *
 * <p>{@code entityId} stays singular on purpose — bulk actions store a
 * comma-joined list of ids in that column, so splitting it on commas would
 * silently break the "history of this entity" lookup.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdminActivityLogFilterDTO {
    private Timestamp startDate;
    private Timestamp endDate;
    private List<String> actorIds;
    private List<String> entityTypes;
    private String entityId;
    private List<String> actions;
}
