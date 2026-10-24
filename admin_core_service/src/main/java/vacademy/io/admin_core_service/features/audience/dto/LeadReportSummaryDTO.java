package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Aggregate report payload for the Lead Reports page. All counts are institute-scoped and date-bounded
 * (submitted_at within [from, to]). OPTED_OUT leads are excluded everywhere so the numbers match what
 * counsellors actually work on.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadReportSummaryDTO {

    /** Date range echoed back so the FE can render the bounds it asked for. */
    private String fromDate;
    private String toDate;

    private Totals totals;
    private List<StatusBreakdown> byStatus;
    private List<SourceBreakdown> bySource;
    private List<TierBreakdown> byTier;
    private List<DailyTrendPoint> trendByDay;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Totals {
        private long totalLeads;
        private long convertedLeads;
        private long lostLeads;
        private long activeLeads;          // neither converted nor lost
        private Double conversionRate;     // % (0–100) — null when totalLeads == 0
        private Long respondedLeads;       // leads with at least one counsellor action
        private Double avgResponseMinutes; // mean (first-action - submitted_at) for responded leads
        private Long tatMetCount;          // first response ≤ submitted_at + TAT minutes (null when TAT disabled)
        private Double tatMetRate;         // % over responded leads (null when TAT disabled)
        private Long overdueLeads;         // leads currently TAT_OVERDUE or FOLLOW_UP_OVERDUE
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StatusBreakdown {
        private String statusKey;   // conversion_status value
        private String label;       // resolved from lead_status catalog (fallback = key)
        private String color;       // resolved from lead_status catalog
        private long count;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SourceBreakdown {
        private String sourceType;  // WEBSITE, GOOGLE_ADS, etc.
        private long total;
        private long converted;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TierBreakdown {
        private String tier;        // HOT / WARM / COLD / UNCLASSIFIED
        private long count;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DailyTrendPoint {
        private String date;        // ISO yyyy-MM-dd in the server's TZ
        private long submitted;
        private long converted;
    }
}
