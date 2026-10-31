package vacademy.io.admin_core_service.features.hr_employee.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * One institute staff member (ADMIN/TEACHER/EVALUATOR/COUNSELLOR user_role
 * holder) with their HR linkage state — the row of the staff↔HR unification
 * bridge (Phase F1).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StaffBridgeRowDTO {

    private String userId;
    private String fullName;
    private String email;
    private String mobileNumber;

    /** Staff roles this user holds in the institute (subset of ADMIN/TEACHER/EVALUATOR/COUNSELLOR). */
    private List<String> roles;

    /** ACTIVE when any staff user_role row is ACTIVE, else INVITED. */
    private String status;

    /** HR linkage: set when an EmployeeProfile exists for (userId, institute). */
    private String employeeId;
    private String employeeCode;

    /** True when the user has an ACTIVE teaching assignment (faculty mapping, suborg IS NULL). */
    private boolean teaches;

    /**
     * Set when NO profile exists here but the user already has one in another
     * institute — hr_employee_profile.user_id is globally unique, so creating a
     * profile for them in this institute is impossible. Null otherwise.
     */
    private String blockedReason;
}
