package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/** What a void undid, so the admin UI can say exactly what changed. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PaymentVoidResultDTO {
    private String paymentLogId;
    private Double amount;
    private String currency;
    /** Installments whose paid amount was reduced again. */
    private int installmentsReopened;
    /** Invoices voided (generated from the payment) or reopened (a bill the payment had settled). */
    private int invoicesUpdated;
    /** Amount taken back out of the learner's "total paid". */
    private BigDecimal creditReversed;
}
