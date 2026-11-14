package vacademy.io.admin_core_service.features.catalogue_analytics.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Everything the site-analytics screen renders, in one round trip. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CatalogueAnalyticsResponse {

    private long views;
    private long visitors;
    private long sessions;
    /** Leads captured in the same window, so the funnel is one number. */
    private long leads;

    private List<DailyPoint> daily;
    private List<NamedCount> pages;
    private List<NamedCount> sources;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DailyPoint {
        private String day;
        private long views;
        private long visitors;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NamedCount {
        private String name;
        private long views;
        private long visitors;
    }
}
