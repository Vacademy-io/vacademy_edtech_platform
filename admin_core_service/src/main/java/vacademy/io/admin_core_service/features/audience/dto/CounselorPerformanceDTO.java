package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Per-counsellor performance rows for the Counsellor Performance section of the Lead Reports page.
 * One row per counsellor with leads assigned in the date range. Names are resolved from auth-service
 * in batch by the service layer.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CounselorPerformanceDTO {

    private String fromDate;
    private String toDate;
    /** TAT threshold in minutes used for the tat_met calculation (null when TAT is disabled). */
    private Integer tatMinutes;
    /** Same threshold in whole hours, rounded up — kept for older clients; prefer tatMinutes. */
    private Integer tatHours;

    private List<Row> rows;
    private Summary summary;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        private String counselorId;
        private String counselorName;   // resolved from auth-service; falls back to id if lookup fails
        private long leadsAssigned;     // distinct leads ever assigned to this counsellor in range
        private long leadsResponded;    // leads with at least one response event (see AudienceResponseRepository)
        private long conversions;
        private Double conversionRate;  // %
        private Double avgResponseMinutes;
        private Long tatMetCount;       // null when TAT disabled
        private Double tatMetRate;      // %; null when TAT disabled
        private long openLeads;         // currently unconverted + not lost
        private long overdueLeads;      // TAT_OVERDUE or FOLLOW_UP_OVERDUE right now
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Summary {
        private long totalCounselors;
        private Double avgResponseMinutes;  // weighted by responded leads
        private Double avgConversionRate;   // weighted by leadsAssigned
    }
}
