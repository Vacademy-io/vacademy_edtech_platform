package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDate;
import java.time.LocalTime;

@Getter
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerUpcomingClassDTO {
    private String scheduleId;
    private String sessionId;
    private String title;
    private String subject;
    private LocalDate meetingDate;
    private LocalTime startTime;
    private LocalTime lastEntryTime;
    private String accessLevel;
    private String timezone;
    // Provider room link (schedule override, else the session default) — the learner normally
    // joins through the portal link instead, which is what records attendance.
    private String meetingLink;
    // True while the class is in progress (start ≤ now < last entry, in the session's timezone).
    private boolean live;
}
