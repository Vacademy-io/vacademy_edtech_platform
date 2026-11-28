package vacademy.io.admin_core_service.features.hr_teaching.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * One teacher's computed pay line. Statuses:
 * ELIGIBLE (preview: would be materialized), CREATED (adjustment written),
 * SKIPPED_EXISTING (TEACHING_PAY adjustment already present for the month),
 * UNRATED (no valid rate key on the employee profile custom fields),
 * ZERO_QUANTITY (rated but nothing billable), NO_EMPLOYEE_PROFILE.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TeachingPayLineDTO {

    private String employeeId;
    private String userId;
    private String employeeName;
    private String employeeCode;

    /** PER_SESSION | PER_HOUR — null when unrated. */
    private String basis;
    private BigDecimal rate;

    private int sessionsWithAttendance;
    private long taughtMinutes;
    /** taughtMinutes / 60 rounded to 2 decimals (payable hours for PER_HOUR basis). */
    private BigDecimal taughtHours;

    private BigDecimal amount;
    private String status;
    /** hr_payroll_adjustment.id once materialized. */
    private String adjustmentId;
    private String note;
}
