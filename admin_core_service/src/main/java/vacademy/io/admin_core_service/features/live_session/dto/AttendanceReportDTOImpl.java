package vacademy.io.admin_core_service.features.live_session.dto;


import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.Date;


@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class AttendanceReportDTOImpl implements AttendanceReportDTO {
    private String studentId;
    private String fullName;
    private String email;
    private String mobileNumber;
    private String gender;
    private Date dateOfBirth;
    private String instituteEnrollmentNumber;
    private String enrollmentStatus;
    private String attendanceStatus;
    private String attendanceDetails;
    private Timestamp attendanceTimestamp;
    private String sourceType;
    private String statusType;
    private String engagementData;
    private Integer providerTotalDurationMinutes;
    /** Exact seconds when the provider reports them (BBB); NULL for Zoom. */
    private Integer providerTotalDurationSeconds;
    private String feedbackDetails;
    private String batchName;
    private Timestamp registeredAt;
}
