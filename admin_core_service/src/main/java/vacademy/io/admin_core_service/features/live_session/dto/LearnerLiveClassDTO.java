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
public class LearnerLiveClassDTO {
    private String scheduleId;
    private String sessionId;
    private String title;
    private String subject;
    private LocalDate meetingDate;
    private LocalTime startTime;
    private LocalTime lastEntryTime;
    private String accessLevel;
    private String timezone;
    // PRESENT / ABSENT / UNMARKED
    private String attendanceStatus;
    private String statusType;
    // Minutes the provider (Zoom/BBB/Meet) says the learner was in the class; null when unknown.
    private Integer durationMinutes;
    // Scheduled class length (start → last entry), the denominator of the score's time component.
    private Integer meetingDurationMinutes;
    // 0-100 engagement score (LiveClassEngagementScore); null when the class has nothing to score.
    private Integer concentrationScore;
}
