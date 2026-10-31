package vacademy.io.admin_core_service.features.audience.dto.reports;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * GET /v1/reports/revenue — money actually collected from CONVERTED leads in the window.
 *
 * Definition (per the product decision "revenue only comes after the lead is converted"):
 *   revenue counts a {@code payment_log} row only when
 *     - payment_status = 'PAID', AND
 *     - the paying user is a lead of this institute whose {@code user_lead_profile.conversion_status}
 *       = 'CONVERTED' (the same user the conversion is stamped on), AND
 *     - the payment's {@code created_at} falls in the [from, to) window (institute TZ).
 *
 * Source / counsellor attribution uses the lead profile's denormalized
 * {@code best_source_type} / {@code assigned_counselor_id} — the same identity the rest of the
 * report suite scopes on. Payments from non-lead students never appear here.
 *
 * Alongside the cash view, {@code admissions} / {@code bookedRevenue} count converted leads ENROLLED
 * in the window (institute-TZ enrolled_date) and the full fee on those enrolments' plans, collected
 * or not — the number counsellors are measured on.
 *
 * All amounts are in {@link #currency} (the modal currency across the institute's PAID payments).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RevenueReportDTO {

    /** ISO currency code the amounts are expressed in (default INR). */
    private String currency;
    private Totals totals;
    private List<SourceRow> bySource;
    private List<CounsellorRow> byCounsellor;
    /** Daily collected-revenue series (institute-TZ days), gap-filled to zero. */
    private List<DayPoint> trend;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Totals {
        private double revenue;
        /** Distinct converted leads who paid in-window. */
        private long payingLeads;
        /** payment_log rows counted. */
        private long payments;
        /** revenue / payingLeads — null when payingLeads = 0. */
        private Double avgDealValue;
        /** Distinct converted leads enrolled in-window. */
        private long admissions;
        /** Full fee (all non-cancelled installments) on those in-window enrolments. */
        private double bookedRevenue;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SourceRow {
        /** best_source_type of the paying lead ('UNKNOWN' when untagged). */
        private String sourceType;
        private double revenue;
        private long payingLeads;
        private long payments;
        private Double avgDealValue;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CounsellorRow {
        private String userId;
        /** Hydrated via auth-service batch lookup; null when hydration fails. */
        private String name;
        private double revenue;
        private long payingLeads;
        private long payments;
        private Double avgDealValue;
        private long admissions;
        private double bookedRevenue;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DayPoint {
        /** Institute-TZ calendar date, yyyy-MM-dd. */
        private String date;
        private double revenue;
        private long payments;
    }
}
