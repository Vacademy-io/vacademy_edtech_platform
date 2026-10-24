package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.LocalDate;
import java.util.List;

/**
 * Request body for the admin Live Class Dashboard
 * (POST /admin-core-service/live-session-report/dashboard).
 * Empty {@code batchIds}/{@code instructorIds} mean "all".
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LiveClassDashboardRequest {

    private String instituteId;

    // Meeting-date range (inclusive). Both required.
    private LocalDate startDate;
    private LocalDate endDate;

    // Classes of these batches (package_session ids); attendance is then counted
    // against the learners of these batches only. Empty = all.
    private List<String> batchIds;

    // Classes taught by any of these users (effective instructors). Empty = all.
    private List<String> instructorIds;

    // Class drill-down only: the schedule (one occurrence of a class) to open.
    private String scheduleId;

    // At-risk list only: flag learners who missed at least this many finished
    // classes in the range. Null = 3.
    private Integer minMissed;

    // At-risk list only: DROPPED = attended at least once in the range, then
    // stopped; NEVER = attended none; ALL (default) = both.
    private String atRiskView;
}
