package vacademy.io.admin_core_service.features.usage_metering.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
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
        /** This month against the institute's allowance; null when it has none. */
        private AllowanceStatus allowance;
        /** Last month against the allowance (today's terms); null when it has none. */
        private AllowanceStatus allowancePreviousMonth;
        /** Last month's wallet charge, once made; null otherwise. */
        private UsageCharge previousMonthCharge;
    }

    /** An institute's storage and bandwidth allowance (institute_usage_allowance). */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class UsageAllowance {
        private String instituteId;
        private double includedStorageGb;
        private double includedBandwidthGb;
        /** Price per extra GB-month of storage, in currency. */
        private double storageRatePerGb;
        /** Price per extra GB delivered, in currency. */
        private double bandwidthRatePerGb;
        /** A three-letter code (shown, billed by hand) or CREDITS (deducted from the wallet). */
        private String currency;
        /** Storage pack added to the included storage. */
        private double addonStorageGb;
        /** The pack's fixed monthly price, in currency. */
        private double addonPricePerMonth;
        /** First month charged to the wallet (YYYY-MM); null for a shown-only plan. */
        private String chargeFromMonth;
        private String note;
        private String updatedBy;
        private Instant updatedAt;
    }

    /** Body of PUT .../institutes/{id}/allowance. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class UsageAllowanceRequest {
        private Double includedStorageGb;
        private Double includedBandwidthGb;
        private Double storageRatePerGb;
        private Double bandwidthRatePerGb;
        /** Three-letter code or CREDITS; CREDITS when omitted. */
        private String currency;
        private Double addonStorageGb;
        private Double addonPricePerMonth;
        /** YYYY-MM, not before the current month; next month when omitted. */
        private String chargeFromMonth;
        private String note;
    }

    /** One month charged to an institute's wallet (institute_usage_charge). */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class UsageCharge {
        private String instituteId;
        private String month;
        /** CHARGED or FAILED (retried by the next run). */
        private String status;
        private double credits;
        private long storageAverageBytes;
        private long storageExtraBytes;
        private long bandwidthBytes;
        private long bandwidthExtraBytes;
        private double addonCredits;
        private String error;
        private Instant updatedAt;
    }

    /**
     * One month against the allowance. Storage is the month's average stored bytes
     * (nightly snapshots so far); bandwidth the month's total. Charges are in currency.
     */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AllowanceStatus {
        /** YYYY-MM */
        private String month;
        private double includedStorageGb;
        private double includedBandwidthGb;
        private double storageRatePerGb;
        private double bandwidthRatePerGb;
        private String currency;
        private double addonStorageGb;
        private double addonPrice;
        /** True when this month is (or will be) deducted from the credit wallet. */
        private boolean chargedToWallet;
        private String chargeFromMonth;
        /** Nights in the month with a storage snapshot; the average is over these. */
        private int storageSnapshotDays;
        private long storageAverageBytes;
        private long storageExtraBytes;
        private long bandwidthBytes;
        private long bandwidthExtraBytes;
        private double storageCharge;
        private double bandwidthCharge;
        private double totalCharge;
    }

    /** Every institute on an allowance with the month's figures, for super admins. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AllowanceListItem {
        private String instituteName;
        private UsageAllowance allowance;
        private AllowanceStatus status;
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
        /** Part of bandwidth_bytes served straight from S3 (billed per GB), not the flat-rate CDN. */
        private long bandwidthS3DirectBytes;
        /** Our approximate monthly cost in INR at the configured rates. */
        private double storageCostInr;
        private double bandwidthCostInr;
        private double totalCostInr;
        /** The month against the institute's allowance; null when it has none. */
        private AllowanceStatus allowance;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CostRates {
        private double storageUsdPerGbMonth;
        /** Direct-from-S3 bandwidth, per GB. */
        private double bandwidthUsdPerGb;
        /** CDN bandwidth, per GB at the margin (0 on a flat-rate plan). */
        private double cdnUsdPerGb;
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
