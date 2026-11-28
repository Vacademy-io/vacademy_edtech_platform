package vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AttendanceSection {

    private boolean available;
    private Double overallPercentage;
    private Integer present;
    private Integer absent;

    /** Count of LATE-status sessions. Zero when LATE status is not tracked. */
    private Integer late;

    /** Total sessions = present + absent + late + unmarked. */
    private Integer totalSessions;

    /** "up" | "down" | "steady" | null when no prior report available. */
    private String trend;

    /** e.g. "+4%" — null when no prior report available. */
    private String changeVsPrevious;

    /** LLM-generated note about attendance pattern. */
    private String note;

    /** Weekly attendance percentages bucketed by ISO week within the report window. */
    private List<WeeklyBucket> weekly;

    /** Internal detail — collected but not serialized in the v2 report JSON. */
    @JsonIgnore
    private Integer unmarked;

    /** Full session list — used internally by collectors; excluded from JSON output. */
    @JsonIgnore
    private List<SessionAttendanceItem> sessions;

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class WeeklyBucket {
        /** Label like "Jun 01–07". */
        private String week;
        private Double percentage;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SessionAttendanceItem {
        /** The live session the class belongs to, for filtering by session. */
        private String sessionId;
        private String date;
        private String title;
        private String subject;
        private String status;
        private Double durationMinutes;
        /** Raw engagement_data JSON parsed into a flexible map. */
        private Map<String, Object> engagement;
    }
}
