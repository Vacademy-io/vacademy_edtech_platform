package vacademy.io.admin_core_service.features.live_activity.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Everything the dashboard needs, in ONE response.
 *
 * <p>Deliberately not an endpoint per card. Institute Pulse went the other way -- five
 * endpoints, a cache tier each, a cross-service HMAC fan-out -- and that is exactly the
 * shape this feature exists to avoid. Every figure below comes from grouped queries over a
 * single table, so one round trip answers the whole page.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class LiveActivityAnalyticsDTO {

    private Kpis kpis;

    /** Ordered stages, widest first. The drop-off between them is the point. */
    private List<NamedCount> funnel;

    /** Hourly buckets across the requested window. */
    private List<TimeBucket> timeline;

    private List<NamedCount> leadSources;
    private List<NamedCount> counsellors;
    private List<NamedCount> callOutcomes;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Kpis {
        private long leads;
        private long enrolments;
        private double revenue;
        private String currency;
        private long callsPlaced;
        private long callsConnected;
        /**
         * Prospects who filled the invite form and have not enrolled.
         *
         * <p>Read from the live ABANDONED_CART status rather than inferred from the absence
         * of a later payment event, so it clears itself the moment they enrol.
         */
        private long needsAttention;

        /** Same measures over the preceding window of equal length, for the deltas. */
        private long previousLeads;
        private long previousEnrolments;
        private double previousRevenue;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NamedCount {
        private String name;
        private long count;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TimeBucket {
        private long startEpochMillis;
        private long count;
    }
}
