package vacademy.io.admin_core_service.features.hr_attendance.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RegularizationDTO {

    private String id;
    private String attendanceId;
    private String employeeId;
    /** Read-only context for the approval queue; ignored on request bodies. */
    private String employeeCode;
    private LocalDate attendanceDate;
    private String approvedBy;
    private LocalDateTime approvedAt;
    private String originalStatus;
    private String requestedStatus;
    private LocalDateTime originalCheckIn;
    private LocalDateTime originalCheckOut;
    private LocalDateTime requestedCheckIn;
    private LocalDateTime requestedCheckOut;
    private String reason;
    private String approvalStatus;
    private String remarks;
}
