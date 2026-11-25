package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;

import java.util.List;
import java.util.Map;

/**
 * Extra learner columns for the admin attendance table of one class, keyed by user id.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerReportFieldsDTO {
    /** Latest non-blank answer per institute custom field — same item shape as /public-registration. */
    private Map<String, List<CustomFieldDTO>> customFields;
    /** Profile (system) fields by system-field key, e.g. USERNAME, CITY, FATHER_NAME. Blank ones left out. */
    private Map<String, Map<String, String>> systemFields;
}
