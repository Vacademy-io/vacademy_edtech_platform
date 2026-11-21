package vacademy.io.admin_core_service.features.usage_metering.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/**
 * Response shapes for storage and bandwidth usage. Byte counts are raw bytes; the UI
 * formats them. Storage is a daily snapshot (S3 Inventory), bandwidth a daily sum.
 */
public final class UsageDTOs {

    private UsageDTOs() {
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CategoryUsage {
        private String category;
        private long bytes;
        /** Objects for storage, requests for bandwidth. */
        private long count;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DailyPoint {
        private LocalDate date;
        private long bytes;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class MonthlyPoint {
        /** YYYY-MM */
        private String month;
        private long bytes;
    }

    /** One institute's own usage, for its admins. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class InstituteUsageResponse {
        private String instituteId;
        /** Date of the latest storage snapshot; null before the first one. */
        private LocalDate storageAsOf;
        private long storageBytes;
        private long storageObjects;
        private List<CategoryUsage> storageByCategory;
        /** Total stored bytes per snapshot day, last 90 days. */
        private List<DailyPoint> storageTrend;
        /** First day bandwidth was measured; null before the first day. */
        private LocalDate bandwidthTrackingSince;
        /** YYYY-MM of the bandwidth_month_* fields. */
        private String bandwidthMonth;
        private long bandwidthMonthBytes;
        private long bandwidthMonthRequests;
        private List<CategoryUsage> bandwidthMonthByCategory;
        /** Bytes delivered per day, last 30 days. */
        private List<DailyPoint> bandwidthDaily;
        /** Bytes delivered per month, last 6 months. */
        private List<MonthlyPoint> bandwidthMonthly;
    }

    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class InstituteUsageRow {
        private String instituteId;
        private String instituteName;
        private long storageBytes;
        private long recordingBytes;
        private long bandwidthBytes;
        private long bandwidthRequests;
        /** Our approximate monthly cost in INR at the configured rates. */
        private double storageCostInr;
        private double bandwidthCostInr;
        private double totalCostInr;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CostRates {
        private double storageUsdPerGbMonth;
        private double bandwidthUsdPerGb;
        private double usdToInr;
    }

    /** Every institute's usage, for platform super admins. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PlatformUsageResponse {
        private LocalDate storageAsOf;
        private String month;
        private LocalDate bandwidthTrackingSince;
        private CostRates rates;
        /** Sorted by total cost, highest first. */
        private List<InstituteUsageRow> institutes;
        /** Files no institute could be derived for. */
        private InstituteUsageRow unassigned;
        private InstituteUsageRow totals;
    }
}
