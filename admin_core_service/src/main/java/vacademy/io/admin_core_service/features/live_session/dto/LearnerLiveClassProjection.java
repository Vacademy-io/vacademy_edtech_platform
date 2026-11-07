package vacademy.io.admin_core_service.features.live_session.dto;

import java.time.LocalDate;
import java.time.LocalTime;

/**
 * One live class occurrence a learner was expected at, with their attendance log for it.
 * Backs the learner-profile Live Sessions tab.
 */
public interface LearnerLiveClassProjection {
    String getScheduleId();
    LocalDate getMeetingDate();
    LocalTime getStartTime();
    LocalTime getLastEntryTime();
    String getSessionId();
    String getSessionTitle();
    String getSubject();
    String getAccessLevel();
    String getTimezone();
    String getAttendanceStatus();
    // ONLINE / OFFLINE — how the attendance was recorded; null when unmarked.
    String getStatusType();
    Integer getDurationMinutes();
    // Raw live_session_logs.engagement_data JSON (BBB counters + activeness keys).
    String getEngagementData();
}
