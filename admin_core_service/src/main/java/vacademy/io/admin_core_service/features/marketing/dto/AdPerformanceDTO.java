package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * Ad performance for one institute over an inclusive date window: platform spend (from
 * ad_spend_daily) next to the enquiries and admissions the CRM attributes to each ad platform.
 *
 * <p>Platform keys: META, GOOGLE, YOUTUBE (Google campaigns with channel VIDEO). Costs are null when
 * the divisor is 0 or the platform has no spend. Spend is in each ad account's currency; when the
 * institute has accounts in more than one currency {@code mixed_currency} is true and the sums are
 * plain sums (no conversion).
 */
@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdPerformanceDTO {

    private LocalDate from;
    private LocalDate to;
    private String currency;
    private boolean mixedCurrency;
    private Totals totals;
    private List<PlatformRow> platforms;
    private List<DailyRow> daily;
    private List<CampaignRow> campaigns;
    private Unattributed unattributed;
    /** Budget-move advice (never applied by us); null when the data cannot support one. */
    private Suggestion suggestion;
    /** Connected (not disconnected) ad accounts of the institute. */
    private List<AdAccountDTO> accounts;
    /** Latest successful sync over those accounts; null when none has synced yet. */
    private Instant lastSyncedAt;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Totals {
        private BigDecimal spend;
        private long clicks;
        private long impressions;
        /** Enquiries attributed to an ad platform. */
        private long enquiries;
        /** Admissions attributed to an ad platform. */
        private long admissions;
        private BigDecimal costPerEnquiry;
        private BigDecimal costPerAdmission;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PlatformRow {
        /** META | GOOGLE | YOUTUBE */
        private String platform;
        private BigDecimal spend;
        private long clicks;
        private long impressions;
        private long enquiries;
        private long admissions;
        private BigDecimal costPerEnquiry;
        private BigDecimal costPerAdmission;
        /** Platform-reported leads / conversions (reference only; the CRM numbers are the truth). */
        private BigDecimal platformLeads;
        /** Ad accounts with spend on this platform in the window. */
        private int accounts;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DailyRow {
        private LocalDate day;
        private String platform;
        private BigDecimal spend;
        private long enquiries;
        private long admissions;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CampaignRow {
        private String platform;
        /** Null for the per-platform "Other / not matched" row (leads with no known campaign). */
        private String campaignId;
        /** Null when the campaign has no synced spend (e.g. its ad account is not connected). */
        private String campaignName;
        /** META for Meta; Google advertising_channel_type (SEARCH, PERFORMANCE_MAX, VIDEO, ...). */
        private String channel;
        private BigDecimal spend;
        private long clicks;
        private long impressions;
        private long enquiries;
        private long admissions;
        private BigDecimal costPerEnquiry;
        private BigDecimal costPerAdmission;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Unattributed {
        private long enquiries;
        private long admissions;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Suggestion {
        private String bestPlatform;
        private BigDecimal bestCostPerAdmission;
        private String worstPlatform;
        /** Null when the worst platform has spend but no admissions. */
        private BigDecimal worstCostPerAdmission;
        private BigDecimal suggestedAmount;
    }
}
