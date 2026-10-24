package vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Request for the internal "what is each learner's enrollment number" lookup, used by
 * assessment_service's OMR sheets: a student bubbles that number on the sheet and the
 * scan is matched back to them by it.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EnrollmentNumbersRequest {
    private String instituteId;
    private List<String> userIds;
    /** Mapping statuses to read. Defaults to ACTIVE when null/empty. */
    private List<String> statuses;
}
