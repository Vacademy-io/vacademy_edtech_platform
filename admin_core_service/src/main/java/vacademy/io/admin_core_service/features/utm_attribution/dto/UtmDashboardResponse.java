package vacademy.io.admin_core_service.features.utm_attribution.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.List;

/**
 * GET /v1/utm/dashboard — the campaign-attribution report for one institute
 * over a date window.
 *
 * Every count here is of PEOPLE (distinct identities), not of touches, unless
 * the field says "touches". A person who arrives twice from the same campaign
 * (a re-click, a second form) is one person to the marketer asking "how many
 * did this campaign bring me", and counting touches would flatter whichever
 * campaign happened to be re-clicked most.
 *
 * "enrolled" = of those people, how many hold an ACTIVE enrolment in this
 * institute today. It is the number the campaign spend is ultimately judged by,
 * and it is what the raw touch log could never answer on its own.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UtmDashboardResponse {

    private Totals totals;
    private List<Bucket> bySource;
    private List<Bucket> byMedium;
    private List<Bucket> byCampaign;
    private List<Bucket> byContent;
    private List<Bucket> byTerm;
    /** Which capture surface the link pointed at: AUDIENCE, ENROLL_INVITE, … */
    private List<Bucket> bySourceType;
    private List<TrendPoint> trend;
    /** Full source × medium × campaign × surface roll-up, most people first. */
    private List<CampaignRow> campaigns;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Totals {
        private long touches;
        private long people;
        private long enrolled;
        private long distinctSources;
        private long distinctCampaigns;
        /** Leads submitted in the window, attributed or not — the coverage denominator. */
        private long leadsInWindow;
        /** Of those, how many carry at least one recorded touch. */
        private long attributedLeadsInWindow;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Bucket {
        /** The dimension value; null when the touch carried no value for it. */
        private String key;
        private long touches;
        private long people;
        private long enrolled;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TrendPoint {
        /** yyyy-MM-dd in the institute's timezone. */
        private String date;
        private long touches;
        private long people;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CampaignRow {
        private String utmCampaign;
        private String utmSource;
        private String utmMedium;
        private String sourceType;
        private long touches;
        private long people;
        private long enrolled;
        private Timestamp firstSeen;
        private Timestamp lastSeen;
    }
}
