package vacademy.io.admin_core_service.features.live_session.dto;

import java.sql.Timestamp;

public interface GuestAttendanceDTO {
    String getGuestId();
    String getGuestEmail();
    Timestamp getRegisteredAt();
    String getAttendanceStatus();
    String getAttendanceDetails();
    Timestamp getAttendanceTimestamp();
    String getCustomFieldValue();
    String getGuestName();
    String getMobileNumber();
    String getSourceType();
    String getStatusType();
    String getEngagementData();
    Integer getProviderTotalDurationMinutes();

    /** Exact seconds when the provider reports them (BBB); NULL for Zoom. */
    Integer getProviderTotalDurationSeconds();
}

