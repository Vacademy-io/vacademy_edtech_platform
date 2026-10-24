package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Totals for every payment row matching a Manage Payments filter set, so the tiles and tab counts
 * can describe the whole result without the browser downloading it a page at a time.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PaymentLogSummaryResponseDTO {

    /** Rows matching the filters, all statuses together. */
    private long totalCount;

    /** What those rows add up to. Unpaid-invoice rows contribute their invoice total. */
    private double totalAmount;

    /** One entry per (status, currency, due-eligibility) group present in the filtered set. */
    private List<StatusTotal> statusTotals;

    /** Distinct plan names for the institute, for the plan filter's dropdown. */
    private List<String> paymentPlanNames;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StatusTotal {
        private String status;
        private String currency;
        private boolean dueEligible;
        private long count;
        private double amount;
    }
}
