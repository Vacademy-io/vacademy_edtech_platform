package vacademy.io.admin_core_service.features.hr_employee.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Paged staff↔HR bridge roster plus the institute-wide coverage counts an
 * admin needs to onboard payroll. The summary counts always describe the FULL
 * staff roster of the institute, regardless of the role/search filter applied
 * to the page rows.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StaffBridgeResponseDTO {

    private List<StaffBridgeRowDTO> rows;

    private int page;
    private int size;
    /** Rows matching the current role/search filter (across all pages). */
    private long totalElements;

    // ---- coverage summary (unfiltered, whole institute) ----

    /** Distinct users holding any staff role (ADMIN/TEACHER/EVALUATOR/COUNSELLOR) in the institute. */
    private long totalStaff;
    /** Of those, how many already have an HR employee profile in this institute. */
    private long withHrProfile;
    /** Staff with an ACTIVE teaching assignment but no HR profile yet — the payroll gap. */
    private long teachingWithoutProfile;
}
