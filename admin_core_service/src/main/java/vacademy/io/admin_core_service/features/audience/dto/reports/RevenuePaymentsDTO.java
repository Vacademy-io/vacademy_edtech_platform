package vacademy.io.admin_core_service.features.audience.dto.reports;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * GET /v1/reports/revenue/payments — the payments behind a Revenue tab number.
 *
 * Same rows as the Revenue tab's "Collected" (PAID payments from converted leads in the window,
 * scoped the same way), one entry per payment_log row, so a counsellor's list adds up to that
 * counsellor's Collected and its length equals Payments.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RevenuePaymentsDTO {

    private String currency;
    /** Sum of every matching payment, even when {@link #truncated}. */
    private double total;
    /** Number of matching payments, even when {@link #truncated}. */
    private long count;
    /** True when more payments matched than were returned in {@link #payments}. */
    private boolean truncated;
    private List<PaymentRow> payments;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PaymentRow {
        private String paymentId;
        private String userId;
        private String studentName;
        private String phone;
        /** Day the payment counts on (yyyy-MM-dd, institute TZ). */
        private String paymentDate;
        /** Day it was entered in the system (yyyy-MM-dd, institute TZ). */
        private String enteredOn;
        private double amount;
        private String paymentMode;
        private String paymentSubMode;
        private String paymentReference;
        private String receiptNumber;
        private String courses;
        private String sourceType;
        private String counsellorId;
        private String counsellorName;
    }
}
