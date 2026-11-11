package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * The read-only answer the dashboard asks for before moving leads to CONVERTED:
 * the institute's rule and which of the leads' people have no course or fee plan here yet.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionCheckResponseDTO {

    /** OFF, WARN or BLOCK. With OFF nothing is looked up and the lists are empty. */
    private String mode;

    /** The status the rule is about (CONVERTED); its label is the institute's own. */
    private String statusKey;

    /** Leads of this institute that were checked; ids of other institutes are left out. */
    private int checked;

    private int withoutCourseCount;

    /** Lead (audience_response) ids whose person has no course or fee plan here yet. */
    private List<String> withoutCourse;
}
