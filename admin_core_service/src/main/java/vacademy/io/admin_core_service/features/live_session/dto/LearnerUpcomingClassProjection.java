package vacademy.io.admin_core_service.features.live_session.dto;

import java.time.LocalDate;
import java.time.LocalTime;

public interface LearnerUpcomingClassProjection {
    String getScheduleId();
    String getSessionId();
    String getTitle();
    String getSubject();
    LocalDate getMeetingDate();
    LocalTime getStartTime();
    LocalTime getLastEntryTime();
    String getAccessLevel();
    String getTimezone();
    String getMeetingLink();
}
