package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.LocalDate;
import java.util.List;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AttendanceFilterRequest {
    // Required. Scopes the whole report to one institute - without it the attendance
    // query spans every institute on the platform (see AttendanceReportService).
    private String instituteId;
    private String name; // Optional for search
    private LocalDate startDate;
    private LocalDate endDate;
    private List<String> batchIds;
    private List<String> liveSessionIds;
}