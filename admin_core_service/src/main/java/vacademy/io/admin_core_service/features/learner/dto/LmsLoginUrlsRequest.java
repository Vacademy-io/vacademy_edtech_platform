package vacademy.io.admin_core_service.features.learner.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Request for the internal "which LMS site does each learner sign in to" lookup, used by
 * auth_service to put the right login link in credential emails.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LmsLoginUrlsRequest {
    /** Optional: limits each learner's lookup to this institute's enrolments. */
    private String instituteId;
    private List<String> userIds;
}
