package vacademy.io.assessment_service.features.assessment_dashboard.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Filters of the Assessment Dashboard. Dates are calendar days (yyyy-MM-dd, inclusive) in
 * {@code timezone}, the admin's browser zone, so "today" means the admin's today.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssessmentDashboardRequest {
    private String instituteId;
    private String startDate;
    private String endDate;
    /** IANA zone, e.g. Asia/Kolkata. Unknown or blank falls back to Asia/Kolkata. */
    private String timezone;
    /** Only assessments assigned to one of these batches, and only their learners. Empty = all. */
    private List<String> batchIds;
    /** Only these play modes (EXAM, MOCK, PRACTICE, SURVEY, ...). Empty = all. */
    private List<String> playModes;
}
