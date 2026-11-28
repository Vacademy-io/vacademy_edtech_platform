package vacademy.io.admin_core_service.features.audience.dto.reports;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * GET /v1/reports/source-performance — per-source lead quality for leads SUBMITTED in the window
 * (institute TZ), RBAC-scoped, OPTED_OUT excluded.
 *
 * Row semantics:
 *   leads           — submissions in-window for this source_type
 *   connected_leads — leads with ≥1 telephony call whose status is in the institute's
 *                     connected-call status set (call matched by response_id, falling back to
 *                     user_id when the call row carries no response_id; calls themselves are
 *                     NOT date-bounded — "did we ever connect with this cohort")
 *   interested      — leads with ≥1 in-window status transition into an "interested" status key
 *   won             — leads whose profile converted in-window (conversion_status = 'CONVERTED')
 *   conversion_rate — won / leads as a 0–100 percentage (null when leads = 0)
 *   revenue         — PAID revenue (created_at in-window) from this source's converted leads
 *   spend / cpl / roi — Wave 2/3 (ad-spend ingestion); always null until spend tracking ships
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SourcePerformanceReportDTO {

    private List<Row> rows;
    /** Column sums across all rows; source_type is null. conversion_rate recomputed over the sums. */
    private Row totals;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        private String sourceType;   // WEBSITE / GOOGLE_ADS / … ('UNKNOWN' when untagged); null on totals
        /** Set when sourceType is the leads' campaign type (see ReportSourceSql). */
        private String campaignType;
        private long leads;
        private long connectedLeads;
        private long interested;
        private long won;
        private Double conversionRate; // % 0–100, one decimal; null when leads = 0
        /** PAID revenue from this source's converted leads, in-window (institute currency). */
        private double revenue;
        private Double spend;          // Wave 2 — always null for now
        private Double cpl;            // Wave 2 — always null for now
        private Double roi;            // Wave 3 — always null for now
    }
}
