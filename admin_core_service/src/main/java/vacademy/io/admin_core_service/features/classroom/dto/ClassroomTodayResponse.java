package vacademy.io.admin_core_service.features.classroom.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Body of {@code GET /admin-core-service/classroom/v1/today}. Field names are the wire
 * contract of the classroom panel and phone page (see TodayResponse in
 * frontend-admin-dashboard/src/classroom-shared/apiTypes.ts).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ClassroomTodayResponse {

    private long serverTimeMs;
    private List<TodayClass> classes;
    private boolean truncated;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TodayClass {
        private String scheduleId;
        private String sessionId;
        private String title;
        private String subject;
        private List<String> batches;
        /** yyyy-MM-dd, the wall-clock date stored on the schedule. */
        private String meetingDate;
        private long startsAtMs;
        /** Null when the class has no end time. */
        private Long endsAtMs;
        /** HH:mm in the session's zone. Clients display this as is. */
        private String timeLabel;
        private String timezone;
        private String linkType;
        private String streamingType;
        private boolean liveNow;
        private List<Instructor> instructors;
        /** Only for providers the platform cannot host. Null otherwise. */
        private String externalLink;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Instructor {
        private String userId;
        private String name;
    }
}
