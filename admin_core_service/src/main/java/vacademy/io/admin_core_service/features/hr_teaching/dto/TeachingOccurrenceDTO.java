package vacademy.io.admin_core_service.features.hr_teaching.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalTime;

/** One session occurrence a teacher hosted (or was scheduled to host). */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TeachingOccurrenceDTO {

    private String scheduleId;
    private String sessionId;
    private String sessionTitle;
    private String subject;
    private LocalTime startTime;
    private LocalTime lastEntryTime;
    /** True when the teacher has an ATTENDANCE_RECORDED log for this occurrence. */
    private boolean attendanceRecorded;
    /** Minutes actually taught (0 when no attendance log exists). */
    private long taughtMinutes;
    /** Scheduled span lastEntryTime - startTime in minutes (0 when times are missing). */
    private long scheduledMinutes;
}
