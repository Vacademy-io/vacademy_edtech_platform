package vacademy.io.admin_core_service.features.hr_teaching.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * One teaching person's month. A "teacher" is any user who created live
 * sessions with occurrences in the month; when no hr_employee_profile matches
 * that userId in the institute, {@code noEmployeeProfile} is true and
 * {@code employeeId}/{@code employeeCode} are null.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TeachingEmployeeSummaryDTO {

    /** hr_employee_profile.id — null when the teacher has no HR profile. */
    private String employeeId;
    private String userId;
    private String employeeName;
    private String employeeCode;
    private boolean noEmployeeProfile;

    private int sessionsScheduled;
    private int sessionsWithAttendance;
    private long totalTaughtMinutes;

    private List<TeachingDayDTO> days;
}
