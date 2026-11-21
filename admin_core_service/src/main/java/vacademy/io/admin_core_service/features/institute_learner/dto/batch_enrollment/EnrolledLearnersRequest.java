package vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Request for the internal "who is enrolled in these batches" lookup.
 *
 * <p>Note what is NOT here: any kind of exclude-these-users list. Callers that need a
 * difference (e.g. "enrolled but has not attempted") take the full set and subtract
 * locally. That is deliberate — an exclusion list has to reach SQL as an opaque array,
 * which the planner cannot estimate, and a generic plan then re-evaluates it per row.
 * Measured on prod: the same page went from 22ms to 434-880ms once Postgres switched to
 * a generic plan, intermittently. Without that predicate the query is plan-stable
 * (22ms custom / 28ms generic on the largest batch in prod).
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EnrolledLearnersRequest {
    private String instituteId;
    private List<String> packageSessionIds;
    /** Mapping statuses to count as enrolled. Defaults to ACTIVE when null/empty. */
    private List<String> statuses;
}
