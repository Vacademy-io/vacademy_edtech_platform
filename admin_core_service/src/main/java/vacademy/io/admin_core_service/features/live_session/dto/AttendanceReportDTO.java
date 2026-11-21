package vacademy.io.admin_core_service.features.live_session.dto;

import java.sql.Timestamp;
import java.util.Date;

public interface AttendanceReportDTO {
    String getStudentId();
    String getFullName();
    String getEmail();
    String getMobileNumber();
    String getGender();
    Date getDateOfBirth();
    String getInstituteEnrollmentNumber();
    String getEnrollmentStatus();
    String getAttendanceStatus();
    String getAttendanceDetails();
    Timestamp getAttendanceTimestamp();
    String getSourceType();
    String getStatusType();
    String getEngagementData();
    Integer getProviderTotalDurationMinutes();

    /** Exact seconds when the provider reports them (BBB); NULL for Zoom. */
    Integer getProviderTotalDurationSeconds();
    String getFeedbackDetails();

    /** Batch the learner was scheduled through; NULL for individually added learners and guests. */
    String getBatchName();

    /**
     * When the person joined this session list: form submit time for guests, the time the batch or
     * learner was linked to the session for internal users.
     */
    Timestamp getRegisteredAt();
}
